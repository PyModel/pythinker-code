export const INSTALL_CHANNELS = [
  { id: 'unix', label: 'Mac / Linux', command: 'curl -fsSL https://code.pythinker.com/pythinker-code/install.sh | bash', icon: '/brand/apple.svg' },
  { id: 'windows', label: 'Windows', command: 'irm https://code.pythinker.com/pythinker-code/install.ps1 | iex', icon: '/brand/windows11.svg' },
  { id: 'brew', label: 'Homebrew', command: 'brew install pythoughts-labs/tap/pythinker-code' },
  { id: 'nix', label: 'Nix', command: 'nix run github:Pythoughts-labs/pythinker-code' },
  { id: 'npm', label: 'npm', command: 'npm install -g @pythoughts/pythinker-code', icon: '/brand/npm.svg' },
];
