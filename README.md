# ImageModel

A web-based 3D modeling application that transforms 2D images into textured 3D models. Import a photo, correct perspective distortion, and use intuitive tools to extrude, cut, and inset faces to create 3D geometry.

## Features

### Image Import & Perspective Correction
- Import images from your device or camera
- **Perspective alignment** - Define 4 corner points to correct perspective distortion
- Adjustable aspect ratio for non-square surfaces
- Pinch-to-zoom and pan for precise point placement
- Live preview of corrected perspective

### 3D Modeling Tools
- **Select** - Click or drag to select faces for editing
- **Cut** - Split faces with edge-to-edge or face-to-face cut lines
  - Edge mode: Click on edges to define cut endpoints
  - Face mode: Click anywhere on faces to draw cut lines
  - Drag endpoints to adjust before confirming
- **Extrude** - Pull selected faces outward or inward to add depth
- **Inset** - Create inner faces with adjustable thickness
  - Grouped mode: Inset multiple faces as a single region
  - Individual mode: Inset each face separately

### Viewport & Navigation
- Orbit, pan, and zoom the 3D view
- Toggle grid visibility
- Snap to grid option
- Reset camera to default view
- Real-time distance indicator during extrude/inset operations

### Export
- Export as OBJ with MTL material file and texture
- Automatic ZIP bundling for mobile downloads
- Preserves UV mapping for accurate texture projection

### Quality of Life
- Full undo/redo support
- Session history with thumbnails
- Keyboard shortcuts for all major actions
- Mobile-friendly touch controls
- PWA support - install as a standalone app

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/imagemodel.git
cd imagemodel

# Install dependencies
npm install

# Start development server
npm run dev
```

### Build for Production

```bash
npm run build
npm run preview  # Preview the production build
```

## Usage

1. **Import an image** - Click the import button or drag and drop an image
2. **Correct perspective** (optional) - Tap 4 corners of a rectangular surface, adjust ratio if needed, then confirm
3. **Model your object** - Use Cut to divide faces, Select to choose faces, then Extrude or Inset to add depth
4. **Export** - Download your model as an OBJ file with textures

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `S` | Select tool |
| `C` | Cut tool |
| `E` | Extrude tool |
| `F` | Inset tool |
| `P` | Perspective tool |
| `Space` / `Enter` | Confirm action |
| `Escape` | Cancel / Skip |
| `Z` | Undo |
| `X` | Redo |
| `G` | Toggle grid |
| `R` | Reset camera |
| Double-tap `C` | Toggle cut mode (edge/face) |
| Double-tap `F` | Toggle inset mode (grouped/individual) |

## Tech Stack

- **Three.js** - 3D rendering and scene management
- **OpenCV.js** - Perspective transformation
- **Vite** - Build tool and dev server
- **JSZip** - Export bundling for mobile

## Browser Support

- Chrome/Edge 90+
- Firefox 90+
- Safari 15+
- Mobile browsers (iOS Safari, Chrome for Android)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
