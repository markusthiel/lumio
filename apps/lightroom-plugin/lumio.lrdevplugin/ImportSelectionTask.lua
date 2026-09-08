--[[
    ImportSelectionTask.lua

    Fetches the aggregated selection of a Lumio gallery and writes it into
    the active Lightroom catalog. Matching happens on the original
    filename (case-insensitive), with an optional content-hash fallback
    (see HASH-MATCHING below).

    Mapping:
      Lumio picked=true   ->  photo:setRawMetadata("pickStatus", 1)
      Lumio liked=true    ->  Rating = max(rating, 1)
      Lumio rating=N      ->  photo:setRawMetadata("rating", N)
      Lumio color=red/yellow/green
                          ->  photo:setRawMetadata("colorNameForLabel", ...)

    Colour label mapping: Lumio currently has red/yellow/green; Lightroom
    knows Red/Yellow/Green/Blue/Purple. We map 1:1.
]]

local LrApplication    = import "LrApplication"
local LrPathUtils      = import "LrPathUtils"
local LrFileUtils      = import "LrFileUtils"
local LrTasks          = import "LrTasks"
local LrFunctionContext = import "LrFunctionContext"
local LrProgressScope  = import "LrProgressScope"
local LrDialogs        = import "LrDialogs"
local LrMD5            = import "LrMD5"

local LumioApi = require "LumioApi"
local log      = require "Logger"

local M = {}

local COLOR_MAP = {
    red    = "Red",
    yellow = "Yellow",
    green  = "Green",
}

-- Build an index: lowercase filename -> photo. If several photos share the
-- same filename (e.g. two cameras both with DSC_0001.NEF in the same
-- catalog), we store all of them and match every Lumio file against ALL
-- hits.
local function buildIndex(photos)
    local byFull, byBase = {}, {}
    for _, p in ipairs(photos) do
        local fname = p:getFormattedMetadata("fileName")
        if fname then
            local full = fname:lower()
            byFull[full] = byFull[full] or {}
            table.insert(byFull[full], p)

            -- Also index the extension-less basename; see findMatches.
            local base = LrPathUtils.removeExtension(fname):lower()
            byBase[base] = byBase[base] or {}
            table.insert(byBase[base], p)
        end
    end
    return { byFull = byFull, byBase = byBase }
end

-- CRITICAL. Publishing forces the uploaded name to "<basename>.jpg"
-- (LumioPublishService.lua:308) and the server stores it verbatim. Import,
-- on the other hand, indexed the catalog by its REAL filename including the
-- extension, so "int_4325.jpg" could never match the catalog's
-- "int_4325.nef". Measured on a real catalog: dng 1083, nef 967, jpg 91,
-- tif 7 -> 95.8 % of the photos would NEVER have been found.
-- Now: try the exact name first, then the extension-less basename.
-- Returns (photos, kind) where kind is "ok" | "ambiguous" | "none".
local function findMatches(idx, filename)
    local fn = (filename or ""):lower()
    if fn == "" then return nil, "none" end

    -- Publishing ALWAYS sends the name as "<basename>.jpg", so both the exact
    -- name and the basename are relevant. Collect both and only then decide --
    -- returning on the first exact hit would let an exported JPEG in the
    -- catalog win over the RAW master.
    local candidates, seen = {}, {}
    local function add(list)
        for _, p in ipairs(list or {}) do
            if not seen[p] then seen[p] = true; table.insert(candidates, p) end
        end
    end
    add(idx.byFull[fn])
    add(idx.byBase[LrPathUtils.removeExtension(fn)])
    if #candidates == 0 then return nil, "none" end

    -- Prefer the master (RAW/DNG/TIF) over an exported copy
    local masters = {}
    for _, p in ipairs(candidates) do
        local n = (p:getFormattedMetadata("fileName") or ""):lower()
        if not n:match("%.jpe?g$") then table.insert(masters, p) end
    end
    local chosen = (#masters > 0) and masters or candidates

    -- Several masters sharing one basename = e.g. the same shot as both .NEF
    -- and .DNG, two cameras with the same running number, or virtual copies.
    -- We cannot know which one the client's selection refers to from the
    -- filename alone -- see HASH-MATCHING below for how this gets resolved
    -- when the server has an original-file hash for this file.
    if #chosen > 1 then return chosen, "ambiguous" end
    return chosen, "ok"
end

-- HASH-MATCHING. Filename-only matching has two known gaps: (1) several
-- masters sharing one basename can't be told apart ("ambiguous", above),
-- and (2) a file renamed in Lightroom after publishing is never found at
-- all ("missing"). Since the Publish-Service plug-in embeds the MD5 of the
-- ORIGINAL master file into a custom XMP field of the uploaded JPEG (see
-- JpegXmp.lua), and the server surfaces it back as file.originalMd5, we can
-- resolve both gaps by hashing CANDIDATE photos and comparing.
-- Only ever a fallback: files uploaded via the browser/upload-links, or
-- published with an older plug-in version, have no originalMd5 -- for
-- those, this silently does nothing and filename-only behaviour is
-- unchanged.
local function fileMd5(path)
    local f, ferr = io.open(path, "rb")
    if not f then
        error("cannot open file: " .. tostring(ferr))
    end
    local data = f:read("*all")
    f:close()
    if not data or #data == 0 then
        error("file is empty or unreadable: " .. tostring(path))
    end
    return LrMD5.digest(data):lower()
end

-- Disambiguates an "ambiguous" match: hashes just the few candidates
-- involved (typically 2-3) and returns the single photo whose master hash
-- equals originalMd5, or nil if there is no hash, no exact single match,
-- or a candidate's file could not be read (e.g. offline drive).
local function resolveAmbiguousByHash(candidates, originalMd5)
    if not originalMd5 then return nil end
    local found
    for _, photo in ipairs(candidates) do
        local okPath, path = LrTasks.pcall(function() return photo:getRawMetadata("path") end)
        if okPath and path then
            local okHash, hash = LrTasks.pcall(fileMd5, path)
            if okHash and hash == originalMd5 then
                if found then return nil end  -- more than one hit -> stay ambiguous, do not guess
                found = photo
            end
        end
    end
    return found
end

local function applyOne(photo, file, opts)
    -- Pick flag
    if opts.applyPick and file.picked then
        photo:setRawMetadata("pickStatus", 1)  -- 1 = picked, 0 = none, -1 = rejected
    end

    -- Rating: an explicit rating wins; likes give at least 1 star if no
    -- rating has been set yet
    if opts.applyRating and file.rating and file.rating > 0 then
        photo:setRawMetadata("rating", file.rating)
    elseif opts.applyLikes and file.liked then
        local current = photo:getRawMetadata("rating") or 0
        if current < 1 then
            photo:setRawMetadata("rating", 1)
        end
    end

    -- Colour label
    if opts.applyColor and file.color then
        local lr = COLOR_MAP[file.color]
        if lr then
            photo:setRawMetadata("colorNameForLabel", lr)
        end
    end
end

function M.run(opts)
    LrTasks.startAsyncTask(function()
        LrFunctionContext.callWithContext("ImportSelectionTask", function(context)

            local catalog = LrApplication.activeCatalog()
            local progress = LrProgressScope {
                title = "Importing Lumio selection",
                functionContext = context,
            }
            progress:setCancelable(true)

            -- 1. Fetch the selection from the server
            progress:setCaption("Loading selection from Lumio…")
            local ok, data = LrTasks.pcall(LumioApi.getSelection, opts.galleryId)
            if not ok or not data then
                LrDialogs.message(
                    "Lumio",
                    tostring(data):gsub("^.-: ", ""),
                    "critical"
                )
                return
            end

            local files = data.files or {}
            if #files == 0 then
                LrDialogs.message(
                    "Lumio",
                    "This gallery has no files with status 'ready' yet."
                )
                return
            end

            -- 2. Determine the photo pool
            progress:setCaption("Searching catalog…")
            local pool
            if opts.matchScope == "collection" then
                local sources = catalog:getActiveSources()
                pool = {}
                for _, source in ipairs(sources) do
                    -- getPhotos works on both a collection and a folder
                    if source.getPhotos then
                        for _, p in ipairs(source:getPhotos()) do
                            table.insert(pool, p)
                        end
                    end
                end
                if #pool == 0 then
                    LrDialogs.message(
                        "Lumio",
                        "The active collection is empty. Choose another one or " ..
                        "switch to 'In the whole catalog'."
                    )
                    return
                end
            else
                pool = catalog:getAllPhotos()
            end

            local idx = buildIndex(pool)
            local canceled = false

            -- 3. PASS 1 (read-only): match every file by filename, and try to
            -- resolve ambiguous filename hits via hash right away (cheap --
            -- only the 2-3 candidates involved get hashed, not the whole
            -- pool). Nothing is written to the catalog yet.
            local resolved = {}            -- file -> array of photos to apply to
            local ambiguousList = {}
            local missingCandidates = {}   -- files with kind == "none"
            local resolvedAmbiguousCount = 0

            progress:setCaption("Matching filenames…")
            for i, file in ipairs(files) do
                if progress:isCanceled() then canceled = true break end
                progress:setPortionComplete(i, #files)

                local matches, kind = findMatches(idx, file.filename)
                if kind == "ok" then
                    resolved[file] = matches
                elseif kind == "ambiguous" then
                    local photo = resolveAmbiguousByHash(matches, file.originalMd5)
                    if photo then
                        resolved[file] = { photo }
                        resolvedAmbiguousCount = resolvedAmbiguousCount + 1
                    else
                        table.insert(ambiguousList,
                            string.format("%s (%d photos)", file.filename, #matches))
                    end
                else
                    table.insert(missingCandidates, file)
                end
            end

            -- 4. PASS 2 (read-only, opt-in): for files that still weren't
            -- found by filename, try to recover them by hashing candidates
            -- from the search pool and checking against the missing files'
            -- originalMd5. Only runs if the user enabled it and only for
            -- files that actually carry a server-side hash.
            --
            -- PERFORMANCE. Measured on a real 2774-photo catalog: 3.8s when
            -- matchScope narrowed the pool to 70 photos, but 4m12s against
            -- the full library (the default scope), with Lightroom visibly
            -- sluggish and memory climbing throughout. Three causes, all
            -- fixed here:
            --   1. No early exit: once every target hash was found, the
            --      loop kept scanning the rest of the pool for nothing.
            --   2. Photos pass 1 already matched by filename were hashed
            --      again here, uselessly (they're not "missing").
            --   3. fileMd5 reads a candidate's ENTIRE file into RAM just to
            --      rule it out -- for RAW that's 25-80 MB per candidate,
            --      repeated across the whole catalog.
            -- (1) and (2) are free fixes. (3) is the dominant cost and
            -- needs a real pre-filter, not just a patch: LumioPublishService
            -- .lua now embeds the ORIGINAL file's byte size alongside its
            -- hash (computeOriginalMd5 already has the file fully in RAM,
            -- so the size is free there), and the server exposes it as
            -- file.originalSize. Checking a candidate's size is a plain OS
            -- stat call (LrFileUtils.fileAttributes, already used the same
            -- way in uploadOnePhoto) -- no file content is read. Only
            -- candidates whose size matches a hash we're still looking for
            -- get the expensive full read+hash. An exact byte-size
            -- collision between two genuinely different photos is rare, so
            -- this turns "read every RAW in the catalog" into "stat every
            -- RAW, fully read only the handful worth checking" -- identity
            -- is still always confirmed by the real hash, never by size
            -- alone.
            local resolvedByHashCount = 0
            local missing = {}
            if not canceled and opts.matchByHash then
                -- Photos pass 1 already resolved (by filename, or by
                -- disambiguating an ambiguous match) -- skip re-hashing them.
                local usedPhotos = {}
                for _, photos in pairs(resolved) do
                    for _, photo in ipairs(photos) do usedPhotos[photo] = true end
                end

                -- md5 -> array of files sharing that hash. A single hash can
                -- legitimately map to SEVERAL Lumio files: virtual copies of
                -- the same master all hash identically at publish time (see
                -- computeOriginalMd5 in LumioPublishService.lua), so a
                -- catalog with virtual copies can easily produce more than
                -- one uploaded file per original hash. A plain "md5 -> file"
                -- map would keep only the last one and silently never even
                -- attempt the others.
                local targets = {}
                -- Every byte size we might still need to fully hash for --
                -- built from whichever missing files actually carry one.
                local sizesToCheck = {}
                for _, file in ipairs(missingCandidates) do
                    if file.originalMd5 then
                        targets[file.originalMd5] = targets[file.originalMd5] or {}
                        table.insert(targets[file.originalMd5], file)
                        if file.originalSize then
                            sizesToCheck[file.originalSize] = true
                        end
                    end
                end
                if next(targets) then
                    progress:setCaption("Recomputing hashes to find renamed files…")
                    for i, photo in ipairs(pool) do
                        if progress:isCanceled() then canceled = true break end
                        if not usedPhotos[photo] then
                            if i % 20 == 0 then progress:setPortionComplete(i, #pool) end
                            local okPath, path = LrTasks.pcall(function() return photo:getRawMetadata("path") end)
                            if okPath and path then
                                local attrs = LrFileUtils.fileAttributes(path)
                                local size = attrs and attrs.fileSize
                                -- Cheap pre-filter (see PERFORMANCE above):
                                -- only hash candidates whose size could
                                -- possibly match a hash we're still after.
                                if size and sizesToCheck[size] then
                                    local okHash, hash = LrTasks.pcall(fileMd5, path)
                                    if okHash and hash and targets[hash] then
                                        -- Every file sharing this hash resolves
                                        -- to the SAME candidate photo here -- we
                                        -- cannot tell which upload came from
                                        -- which virtual copy, but resolving all
                                        -- of them beats silently dropping every
                                        -- file after the first one.
                                        for _, file in ipairs(targets[hash]) do
                                            resolved[file] = { photo }
                                            resolvedByHashCount = resolvedByHashCount + 1
                                        end
                                        targets[hash] = nil
                                        if not next(targets) then break end  -- all found, stop scanning
                                    end
                                end
                            end
                        end
                    end
                end
            end
            for _, file in ipairs(missingCandidates) do
                if not resolved[file] then table.insert(missing, file.filename) end
            end

            -- 5. Apply everything resolved above, inside ONE transaction so
            -- the user can undo the whole import with a single Cmd/Ctrl-Z.
            --
            -- The whole transaction had no error handling. Any exception (most
            -- commonly: the catalog write lock is unavailable because another
            -- operation holds it) ended up in LR's generic "An internal error
            -- has occurred" dialog -- no log, no summary, and no indication of
            -- whether anything had been written to the catalog at all.
            -- Now: pcall + timeout, and progress:done() plus the summary ALWAYS run.
            local matchedFiles, matchedPhotos, applyErrors = 0, 0, 0

            local okTx, txErr = LrTasks.pcall(function()
                catalog:withWriteAccessDo("Import Lumio selection", function()
                    local total = 0
                    for _ in pairs(resolved) do total = total + 1 end
                    local i = 0
                    for file, photos in pairs(resolved) do
                        i = i + 1
                        if progress:isCanceled() then canceled = true break end

                        progress:setPortionComplete(i, total)
                        progress:setCaption(
                            "Applying selection (" .. i .. "/" .. total .. ")"
                        )

                        matchedFiles = matchedFiles + 1
                        for _, photo in ipairs(photos) do
                            -- This used to be a plain pcall, on the assumption
                            -- that applyOne does not yield. That was wrong: the
                            -- log proved "Yielding is not allowed within a C or
                            -- metamethod call". photo:getRawMetadata and
                            -- setRawMetadata ARE yielding catalog operations, so
                            -- every write that carried real data failed silently
                            -- (57 "successes" were no-ops).
                            local okApply, applyErr = LrTasks.pcall(applyOne, photo, file, opts)
                            if okApply then
                                matchedPhotos = matchedPhotos + 1
                            else
                                applyErrors = applyErrors + 1
                                log:warn(string.format("applyOne failed for %s (%s): %s",
                                    tostring(file.filename),
                                    tostring(photo:getFormattedMetadata("fileName")),
                                    tostring(applyErr)))
                            end
                        end
                    end
                end, { timeout = 30 })
            end)

            progress:done()

            if not okTx then
                log:error("import transaction failed: " .. tostring(txErr))
                LrDialogs.message(
                    "Lumio import failed",
                    "The catalog could not be updated:\n\n" .. tostring(txErr) ..
                    "\n\nThis usually means another operation is holding the " ..
                    "catalog lock. Close other dialogs and try again.",
                    "critical"
                )
                return
            end

            -- 6. Summary
            local summary = string.format(
                "Imported for %d of %d files (%d photos updated in the catalog).",
                matchedFiles, #files, matchedPhotos
            )
            if resolvedAmbiguousCount > 0 then
                summary = summary .. string.format(
                    "\n%d file(s) with an ambiguous filename were resolved by content hash.",
                    resolvedAmbiguousCount)
            end
            if resolvedByHashCount > 0 then
                summary = summary .. string.format(
                    "\n%d renamed file(s) were recovered by content hash.",
                    resolvedByHashCount)
            end
            if canceled then
                summary = "IMPORT WAS CANCELED.\n\n" .. summary ..
                    "\n\nWhat was already written stays in the catalog — " ..
                    "undo it with Cmd+Z if you want it reverted."
            end
            if #ambiguousList > 0 then
                summary = summary .. string.format(
                    "\n\n%d filename(s) SKIPPED because they matched several " ..
                    "photos (e.g. the same shot as both NEF and DNG, or virtual " ..
                    "copies) and could not be told apart by content hash either. " ..
                    "Nothing was written for these — pick the right " ..
                    "photo by hand:\n", #ambiguousList)
                for i = 1, math.min(10, #ambiguousList) do
                    summary = summary .. "  • " .. ambiguousList[i] .. "\n"
                end
                if #ambiguousList > 10 then
                    summary = summary .. "  …and " .. (#ambiguousList - 10) .. " more"
                end
            end
            if applyErrors > 0 then
                summary = summary .. string.format(
                    "\n\n%d photo(s) could not be updated.", applyErrors)
            end
            if #missing > 0 then
                summary = summary .. "\n\nNot found:\n"
                for i = 1, math.min(20, #missing) do
                    summary = summary .. "  • " .. missing[i] .. "\n"
                end
                if #missing > 20 then
                    summary = summary .. "  …and " .. (#missing - 20) .. " more"
                end
                if not opts.matchByHash then
                    summary = summary .. "\n\nTip: enable 'recover renamed files by " ..
                        "content hash' to also search for files that were renamed " ..
                        "after publishing."
                end
            end

            log:info("import done: " .. summary:gsub("\n", " | "))
            LrDialogs.message("Lumio import finished", summary)
        end)
    end)
end

return M
