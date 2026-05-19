--[[
    Logger.lua

    Dünner Wrapper um LrLogger. Schreibt nach
    `~/Documents/LrClassicLogs/Lumio.log` (macOS) bzw.
    `%USERPROFILE%\Documents\LrClassicLogs\Lumio.log` (Windows).

    Verwendung:
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
