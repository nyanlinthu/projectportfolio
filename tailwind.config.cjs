// YG design system remap (same as canvas-kit/demo): the shared kit is written against slate, so remapping slate
// to the design tokens themes it without edits.
const path = require('path')
module.exports = {
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.{ts,tsx}'),
    path.join(__dirname, 'canvas-kit/src/**/*.{ts,tsx}'),
  ],
  theme: { extend: {
    colors: { slate: { 950: '#101F3D', 900: '#16294E', 800: '#1B3159', 700: '#22406E', 600: '#2E4370', 500: '#8A93A6', 400: '#A4ACBC', 300: '#C9CFDB', 200: '#E4E0D3', 100: '#F5EFE2', 50: '#FBF8F1' } },
    borderRadius: { '2xl': '3px', '3xl': '4px', xl: '2px', lg: '2px', full: '9999px' },
    fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], serif: ['Lora', 'Georgia', 'serif'], mono: ['JetBrains Mono', 'ui-monospace', 'monospace'] },
  } },
  plugins: [],
}
