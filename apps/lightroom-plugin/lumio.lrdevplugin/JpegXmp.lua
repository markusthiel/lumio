--[[
    JpegXmp.lua

    Inserts a tiny, self-contained XMP APP1 segment into an already
    rendered JPEG, right after the SOI marker (0xFFD8). Used to stamp the
    MD5 hash (and byte size) of the original file (RAW/master) into the
    uploaded JPEG -- for robust matching during Selection-Import,
    independent of the (possibly changed) filename. The size is a cheap
    pre-filter so a rename-recovery scan doesn't have to fully hash every
    candidate in the catalog, only those whose size already matches.

    Why a NEW segment instead of patching the existing EXIF APP1 segment
    that LR already wrote during render: inserting a new tag into an
    existing TIFF/IFD structure requires re-serializing the whole IFD (all
    following offsets shift). An extra, self-contained APP1 XMP segment is
    a plain byte splice instead -- every reader (Lightroom, exiftool,
    browsers) tolerates several APPn segments as long as they precede SOS
    (Start of Scan).

    Custom "lumio" namespace, so no existing standard field (e.g. IPTC Job
    Identifier) gets overwritten.
]]

local M = {}

M.NAMESPACE_URI = "https://lumio.app/ns/1.0/"

-- Standard XMP identifier for a standard APP1-XMP segment (not Extended
-- XMP) -- must be exactly this null-terminated string, see Adobe XMP Spec
-- Part 3.
local XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0"

local function u16be(n)
    return string.char(math.floor(n / 256) % 256, n % 256)
end

local function buildXmpPacket(md5Hex, sizeBytes)
    local fields = { '<lumio:OriginalMD5>' .. md5Hex .. '</lumio:OriginalMD5>' }
    if sizeBytes then
        table.insert(fields, '<lumio:OriginalSize>' .. tostring(sizeBytes) .. '</lumio:OriginalSize>')
    end
    return table.concat({
        '<?xpacket begin="\239\187\191" id="W5M0MpCehiHzreSzNTczkc9d"?>',
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
        '<rdf:Description rdf:about="" xmlns:lumio="' .. M.NAMESPACE_URI .. '">',
        table.concat(fields),
        '</rdf:Description>',
        '</rdf:RDF>',
        '</x:xmpmeta>',
        '<?xpacket end="w"?>',
    })
end

-- Writes md5Hex (32 hex chars, lowercase) as <lumio:OriginalMD5>, and --
-- when given -- the original file's byte size as <lumio:OriginalSize>,
-- into a new APP1-XMP segment at the start of jpegPath. The size costs
-- nothing extra to obtain (the caller already has the whole master in RAM
-- to compute md5Hex) and lets Selection-Import cheaply rule out most
-- rename-recovery candidates via a plain file-size check before hashing
-- them (see ImportSelectionTask.lua). sizeBytes is optional so existing
-- callers/tests that only care about the hash keep working unchanged.
-- Throws on failure -- callers should treat this as best-effort (embedding
-- must never fail a publish).
function M.embedOriginalMd5(jpegPath, md5Hex, sizeBytes)
    if not (md5Hex and md5Hex:match("^%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x$")) then
        error("JpegXmp: invalid MD5 hash: " .. tostring(md5Hex))
    end
    if sizeBytes ~= nil and (type(sizeBytes) ~= "number" or sizeBytes <= 0 or sizeBytes ~= math.floor(sizeBytes)) then
        error("JpegXmp: invalid size in bytes: " .. tostring(sizeBytes))
    end

    local f, ferr = io.open(jpegPath, "rb")
    if not f then
        error("JpegXmp: cannot open file: " .. tostring(ferr))
    end
    local data = f:read("*all")
    f:close()

    if not data or #data < 4 or data:byte(1) ~= 0xFF or data:byte(2) ~= 0xD8 then
        error("JpegXmp: not a valid JPEG file (missing SOI marker): " .. jpegPath)
    end

    local payload = XMP_HEADER .. buildXmpPacket(md5Hex:lower(), sizeBytes)
    local segmentLen = #payload + 2  -- the length field counts itself
    if segmentLen > 0xFFFF then
        -- Can practically never happen with a 32-char hex payload, but a
        -- silent truncation would be worse than aborting outright.
        error("JpegXmp: XMP payload too large for a standard APP1 segment")
    end
    local segment = string.char(0xFF, 0xE1) .. u16be(segmentLen) .. payload

    -- If the very first segment after SOI is an APP0/JFIF marker, insert
    -- AFTER it instead of before. Some strict readers (print lab intake,
    -- some third-party tools) expect JFIF to stay the first segment in
    -- the file; every reader tolerates our XMP segment appearing right
    -- after it just as well. Otherwise (no APP0, or anything else first)
    -- keep inserting directly after SOI, as before.
    local insertAt = 3  -- 1-indexed: right after the 2-byte SOI
    if #data >= 6 and data:byte(3) == 0xFF and data:byte(4) == 0xE0 then
        local app0Len = data:byte(5) * 256 + data:byte(6)
        if app0Len < 2 or #data < 4 + app0Len then
            error("JpegXmp: malformed or truncated APP0 segment")
        end
        insertAt = 5 + app0Len
    end

    local newData = data:sub(1, insertAt - 1) .. segment .. data:sub(insertAt)

    local out, werr = io.open(jpegPath, "wb")
    if not out then
        error("JpegXmp: cannot write file: " .. tostring(werr))
    end
    out:write(newData)
    out:close()
end

return M
