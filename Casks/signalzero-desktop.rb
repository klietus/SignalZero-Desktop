cask "signalzero-desktop" do
  version "1.1.9"
  sha256 "7025bb09fc81016eb4f8974aab38f73efe208d57df8cdd7a14f51f82e528900f"

  url "https://github.com/klietus/SignalZero-Desktop/releases/download/v#{version}/Signal%20Zero-#{version}-arm64.dmg"
  name "Signal Zero"
  desc "Recursive Symbolic Reasoning Kernel"
  homepage "https://github.com/klietus/SignalZero-Desktop"

  app "Signal Zero.app"

  zap trash: [
    "~/Library/Application Support/signal-zero-desktop",
    "~/Library/Preferences/com.signalzero.desktop.plist",
    "~/Library/Saved Application State/com.signalzero.desktop.savedState",
  ]
end
