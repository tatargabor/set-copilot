# macOS audio prerequisites for set-copilot.
# Install everything in one shot:  brew bundle
#
# Only needed on macOS. On Linux the capture chain uses `parec`
# (PipeWire/PulseAudio), which is usually preinstalled — no Brewfile there.

# Dictation + meeting mic capture. Required.
brew "sox"

# System-audio capture for the meeting copilot (hears the other side of a call).
# Optional: dictation needs only the mic. After install, create a Multi-Output /
# Aggregate device so you both hear and capture the call.
cask "blackhole-2ch"
