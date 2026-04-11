cask "signalzero-desktop" do
  version "1.1.1"
  sha256 "0c9064e39e3894710a02661dc4f63ff76738a88f750a549510eb3a946c3cfa01"

  url "https://github.com/klietus/SignalZero-Desktop/releases/download/v#{version}/SignalZero%20Desktop-#{version}-arm64.dmg"
  name "SignalZero-Desktop"
  desc "Recursive Symbolic Reasoning Kernel"
  homepage "https://github.com/klietus/SignalZero-Desktop"

  app "SignalZero-Desktop.app"

  zap trash: [
    "~/Library/Application Support/signal-zero-desktop",
    "~/Library/Preferences/com.signalzero.desktop.plist",
    "~/Library/Saved Application State/com.signalzero.desktop.savedState",
  ]
end
