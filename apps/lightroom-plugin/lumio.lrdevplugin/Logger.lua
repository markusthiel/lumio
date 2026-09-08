--[[
    Logger.lua

    Thin wrapper around LrLogger. Writes to
    `~/Library/Logs/Adobe/Lightroom/LrClassicLogs/Lumio.log` (macOS,
    confirmed on LrC 15.5) resp.
    `%USERPROFILE%\Documents\LrClassicLogs\Lumio.log` (Windows) --
    LrLogger's log location has moved before across LrC versions, so
    treat this as "check both if one is empty" rather than gospel.

    Usage:
        local log = require "Logger"
        log:trace("debug")
        log:info("info")
        log:warn("warning")
        log:error("error")
]]

local LrLogger = import "LrLogger"

local logger = LrLogger("Lumio")
logger:enable("logfile")

return logger
