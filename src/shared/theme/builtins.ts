import type { Theme } from '../types'

// Temas que vêm com o app. Hex de cor só pode viver aqui e em derive.ts.
const DARK: Theme = {
  name: 'Escuro',
  ui: {
    bg: '#14161a',
    bg2: '#1b1f25',
    bg3: '#22272e',
    line: '#2a2f37',
    fg: '#c9d1d9',
    fgDim: '#7d8590',
    accent: '#58a6ff',
    primaryFg: '#0d1117',
    yellow: '#d29922',
    green: '#3fb950',
    gray: '#484f58',
    red: '#f85149',
    headerBg: '#1f2630',
    selBg: '#2d3a4f',
    warnBg: '#2b2410',
    errBg: '#2d1416',
    errFg: '#ffb3ad'
  },
  terminal: {
    background: '#14161a',
    foreground: '#c9d1d9',
    cursor: '#c9d1d9',
    selectionBackground: '#3b4a63'
  }
}

const LIGHT: Theme = {
  name: 'Claro',
  ui: {
    bg: '#ffffff',
    bg2: '#f6f8fa',
    bg3: '#eaeef2',
    line: '#d0d7de',
    fg: '#1f2328',
    fgDim: '#656d76',
    accent: '#0969da',
    primaryFg: '#ffffff',
    yellow: '#bf8700',
    green: '#1a7f37',
    gray: '#afb8c1',
    red: '#cf222e',
    headerBg: '#f0f3f6',
    selBg: '#ddf4ff',
    warnBg: '#fff8c5',
    errBg: '#ffebe9',
    errFg: '#82071e'
  },
  terminal: {
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#1f2328',
    selectionBackground: '#b6d7ff',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#4d2d00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f'
  }
}

const DARKEST: Theme = {
  name: 'Darkest',
  ui: {
    bg: '#0d1117',
    bg2: '#010409',
    bg3: '#161b22',
    line: '#30363d',
    fg: '#e6edf3',
    fgDim: '#7d8590',
    accent: '#2f81f7',
    primaryFg: '#ffffff',
    yellow: '#d29922',
    green: '#3fb950',
    gray: '#484f58',
    red: '#f85149',
    headerBg: '#161b22',
    selBg: '#1c2d4a',
    warnBg: '#272115',
    errBg: '#25171c',
    errFg: '#ffa198'
  },
  terminal: {
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#2f81f7',
    selectionBackground: '#264f78',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff'
  }
}

const ORANGE_DARK: Theme = {
  name: 'Laranja escuro',
  ui: {
    bg: '#1a1714',
    bg2: '#211d19',
    bg3: '#2a2520',
    line: '#3a332c',
    fg: '#ece4da',
    fgDim: '#9a8f83',
    accent: '#f08a24',
    primaryFg: '#1a1714',
    yellow: '#e0a526',
    green: '#6cc070',
    gray: '#5a5048',
    red: '#f2685b',
    headerBg: '#241f1a',
    selBg: '#4a3218',
    warnBg: '#33260f',
    errBg: '#3a1c18',
    errFg: '#ffb3a6'
  },
  terminal: {
    background: '#1a1714',
    foreground: '#ece4da',
    cursor: '#f08a24',
    selectionBackground: '#6b4416'
  }
}

const ORANGE_LIGHT: Theme = {
  name: 'Laranja claro',
  ui: {
    bg: '#fffdfa',
    bg2: '#fbf5ee',
    bg3: '#f3eadf',
    line: '#e5d6c5',
    fg: '#2b2118',
    fgDim: '#7a6a5a',
    accent: '#d9640b',
    primaryFg: '#ffffff',
    yellow: '#b7791f',
    green: '#2f855a',
    gray: '#c9b9a8',
    red: '#c53030',
    headerBg: '#fbf1e5',
    selBg: '#ffe3c7',
    warnBg: '#fff4d6',
    errBg: '#ffe8e5',
    errFg: '#8a1c12'
  },
  terminal: {
    ...LIGHT.terminal,
    background: '#fffdfa',
    foreground: '#2b2118',
    cursor: '#d9640b',
    selectionBackground: '#ffd2a6'
  }
}

// Temas escolhidos a partir de 10 prévias (19/10/2026)
const DRACULA: Theme = {
  name: 'Dracula',
  ui: {
    bg: '#282a36',
    bg2: '#21222c',
    bg3: '#343746',
    line: '#44475a',
    fg: '#f8f8f2',
    fgDim: '#8a8fb3',
    accent: '#bd93f9',
    primaryFg: '#282a36',
    selBg: '#44475a',
    headerBg: '#2f3141',
    yellow: '#f1fa8c',
    green: '#50fa7b',
    gray: '#6272a4',
    red: '#ff5555',
    warnBg: '#3a3a2a',
    errBg: '#402a33',
    errFg: '#ff9a9a'
  },
  terminal: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#bd93f9',
    selectionBackground: '#44475a',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff'
  }
}

const NORD: Theme = {
  name: 'Nord',
  ui: {
    bg: '#2e3440',
    bg2: '#272c36',
    bg3: '#3b4252',
    line: '#434c5e',
    fg: '#eceff4',
    fgDim: '#8b93a6',
    accent: '#88c0d0',
    primaryFg: '#2e3440',
    selBg: '#3b4a5e',
    headerBg: '#333a47',
    yellow: '#ebcb8b',
    green: '#a3be8c',
    gray: '#4c566a',
    red: '#bf616a',
    warnBg: '#3a3a33',
    errBg: '#3d2f35',
    errFg: '#e8a3a9'
  },
  terminal: {
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#88c0d0',
    selectionBackground: '#434c5e',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4'
  }
}

const TOKYO_NIGHT: Theme = {
  name: 'Tokyo Night',
  ui: {
    bg: '#1a1b26',
    bg2: '#16161e',
    bg3: '#24283b',
    line: '#2f334d',
    fg: '#c0caf5',
    fgDim: '#7a82a8',
    accent: '#7aa2f7',
    primaryFg: '#1a1b26',
    selBg: '#283457',
    headerBg: '#1f2335',
    yellow: '#e0af68',
    green: '#9ece6a',
    gray: '#414868',
    red: '#f7768e',
    warnBg: '#2e2a1f',
    errBg: '#33202a',
    errFg: '#ffa3b5'
  },
  terminal: {
    background: '#1a1b26',
    foreground: '#c0caf5',
    cursor: '#c0caf5',
    selectionBackground: '#33467c',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#c0caf5'
  }
}

const CATPPUCCIN_MOCHA: Theme = {
  name: 'Catppuccin Mocha',
  ui: {
    bg: '#1e1e2e',
    bg2: '#181825',
    bg3: '#313244',
    line: '#45475a',
    fg: '#cdd6f4',
    fgDim: '#9399b2',
    accent: '#cba6f7',
    primaryFg: '#1e1e2e',
    selBg: '#45475a',
    headerBg: '#232336',
    yellow: '#f9e2af',
    green: '#a6e3a1',
    gray: '#585b70',
    red: '#f38ba8',
    warnBg: '#33302a',
    errBg: '#3a2531',
    errFg: '#f5a3bd'
  },
  terminal: {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selectionBackground: '#45475a',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8'
  }
}

const GRUVBOX: Theme = {
  name: 'Gruvbox',
  ui: {
    bg: '#282828',
    bg2: '#1d2021',
    bg3: '#32302f',
    line: '#45403d',
    fg: '#ebdbb2',
    fgDim: '#a89984',
    accent: '#fe8019',
    primaryFg: '#282828',
    selBg: '#504945',
    headerBg: '#2e2c2b',
    yellow: '#fabd2f',
    green: '#b8bb26',
    gray: '#665c54',
    red: '#fb4934',
    warnBg: '#3a3420',
    errBg: '#3c2422',
    errFg: '#ff9f94'
  },
  terminal: {
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#fe8019',
    selectionBackground: '#504945',
    black: '#282828',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#a89984',
    brightBlack: '#928374',
    brightRed: '#fb4934',
    brightGreen: '#b8bb26',
    brightYellow: '#fabd2f',
    brightBlue: '#83a598',
    brightMagenta: '#d3869b',
    brightCyan: '#8ec07c',
    brightWhite: '#ebdbb2'
  }
}

const ONE_DARK: Theme = {
  name: 'One Dark',
  ui: {
    bg: '#282c34',
    bg2: '#21252b',
    bg3: '#2c313a',
    line: '#3e4451',
    fg: '#abb2bf',
    fgDim: '#7f848e',
    accent: '#61afef',
    primaryFg: '#282c34',
    selBg: '#3e4451',
    headerBg: '#2c313a',
    yellow: '#e5c07b',
    green: '#98c379',
    gray: '#5c6370',
    red: '#e06c75',
    warnBg: '#36332a',
    errBg: '#3a2a2e',
    errFg: '#f0a3a9'
  },
  terminal: {
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#528bff',
    selectionBackground: '#3e4451',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff'
  }
}

const ROSE_PINE_DAWN: Theme = {
  name: 'Rosé Pine Dawn',
  ui: {
    bg: '#faf4ed',
    bg2: '#f2e9e1',
    bg3: '#fffaf3',
    line: '#dfdad9',
    fg: '#575279',
    fgDim: '#9893a5',
    accent: '#d7827e',
    primaryFg: '#faf4ed',
    selBg: '#f2e2dc',
    headerBg: '#f4ede8',
    yellow: '#ea9d34',
    green: '#56949f',
    gray: '#cecacd',
    red: '#b4637a',
    warnBg: '#fbeedb',
    errBg: '#f6e1e4',
    errFg: '#8e4057'
  },
  terminal: {
    background: '#faf4ed',
    foreground: '#575279',
    cursor: '#d7827e',
    selectionBackground: '#e9e0de',
    black: '#f2e9e1',
    red: '#b4637a',
    green: '#286983',
    yellow: '#ea9d34',
    blue: '#56949f',
    magenta: '#907aa9',
    cyan: '#d7827e',
    white: '#575279',
    brightBlack: '#9893a5',
    brightRed: '#b4637a',
    brightGreen: '#286983',
    brightYellow: '#ea9d34',
    brightBlue: '#56949f',
    brightMagenta: '#907aa9',
    brightCyan: '#d7827e',
    brightWhite: '#575279'
  }
}

// Temas que vêm com o app: recriados se apagados, nunca sobrescritos pelo editor.
export const BUILTIN_THEMES: Record<string, Theme> = {
  escuro: DARK,
  claro: LIGHT,
  darkest: DARKEST,
  'orange-dark': ORANGE_DARK,
  'orange-light': ORANGE_LIGHT,
  dracula: DRACULA,
  nord: NORD,
  'tokyo-night': TOKYO_NIGHT,
  'catppuccin-mocha': CATPPUCCIN_MOCHA,
  gruvbox: GRUVBOX,
  'one-dark': ONE_DARK,
  'rose-pine-dawn': ROSE_PINE_DAWN
}
export const DEFAULT_THEME = DARK
