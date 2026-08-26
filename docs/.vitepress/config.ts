import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import llmstxt from 'vitepress-plugin-llms'

const rawBase = process.env.VITEPRESS_BASE
const base = rawBase
  ? rawBase.startsWith('/')
    ? rawBase.endsWith('/') ? rawBase : `${rawBase}/`
    : `/${rawBase}/`
  : '/'

const mermaidOptimizeDeps = [
  '@braintree/sanitize-url',
  'dayjs',
  'debug',
  'cytoscape-cose-bilkent',
  'cytoscape',
]

const config = withMermaid(defineConfig({
  base,
  title: 'Pythinker Code CLI Docs',
  description: 'Pythinker Code CLI User Documentation',
  lang: 'en-US',

  head: [
    ['link', { rel: 'icon', type: 'image/x-icon', href: `${base}favicon.ico` }],
    ['meta', { name: 'theme-color', content: '#0a7aff' }],
  ],

  srcExclude: ['AGENTS.md', 'superpowers/**'],

  themeConfig: {
    outline: [2, 3],
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/PyModel/pythinker-code' },
    ],
    nav: [
      { text: 'Guides', link: '/guides/getting-started', activeMatch: '/guides/' },
      { text: 'Customization', link: '/customization/mcp', activeMatch: '/customization/' },
      { text: 'Configuration', link: '/configuration/config-files', activeMatch: '/configuration/' },
      { text: 'Reference', link: '/reference/pythinker-command', activeMatch: '/reference/' },
      { text: 'Release Notes', link: '/release-notes/changelog', activeMatch: '/release-notes/' },
    ],
    sidebar: {
      '/guides/': [
        {
          text: 'Guides',
          items: [
            { text: 'Getting Started', link: '/guides/getting-started' },
            { text: 'Desktop App', link: '/guides/desktop' },
            { text: 'Use in a Browser', link: '/guides/web' },
            { text: 'Common Use Cases', link: '/guides/use-cases' },
            { text: 'Interaction and Input', link: '/guides/interaction' },
            { text: 'Sessions and Context', link: '/guides/sessions' },
            { text: 'Using Goals', link: '/guides/goals' },
            { text: 'Using in IDEs', link: '/guides/ides' },
          ],
        },
      ],
      '/customization/': [
        {
          text: 'Customization',
          items: [
            { text: 'Model Context Protocol', link: '/customization/mcp' },
            { text: 'Agent Skills', link: '/customization/skills' },
            { text: 'Plugins', link: '/customization/plugins' },
            { text: 'Agents and Subagents', link: '/customization/agents' },
            { text: 'Hooks', link: '/customization/hooks' },
            { text: 'Custom Themes', link: '/customization/themes' },
          ],
        },
      ],
      '/configuration/': [
        {
          text: 'Configuration',
          items: [
            { text: 'Config Files', link: '/configuration/config-files' },
            { text: 'Providers and Models', link: '/configuration/providers' },
            { text: 'Config Overrides', link: '/configuration/overrides' },
            { text: 'Environment Variables', link: '/configuration/env-vars' },
            { text: 'Data Locations', link: '/configuration/data-locations' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'pythinker Command', link: '/reference/pythinker-command' },
            { text: 'pythinker acp Subcommand', link: '/reference/pythinker-acp' },
            { text: 'Built-in Tools', link: '/reference/tools' },
            { text: 'Slash Commands', link: '/reference/slash-commands' },
            { text: 'Keyboard Shortcuts', link: '/reference/keyboard' },
            { text: 'Release Channels', link: '/reference/release-channels' },
          ],
        },
      ],
      '/release-notes/': [
        {
          text: 'Release Notes',
          items: [
            { text: 'Changelog', link: '/release-notes/changelog' },
          ],
        },
      ],
    },
  },

  vite: {
    optimizeDeps: {
      include: mermaidOptimizeDeps.map((dep) => `mermaid > ${dep}`),
    },
    plugins: [llmstxt()],
  },
}))

if (config.vite?.optimizeDeps?.include) {
  config.vite.optimizeDeps.include = config.vite.optimizeDeps.include.filter(
    (dep) => !mermaidOptimizeDeps.includes(dep),
  )
}

export default config
