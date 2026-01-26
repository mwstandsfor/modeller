# ImageModel - 3D Modeling from Images

A web-based 3D modeling application that transforms 2D images into textured 3D models. Import photos, correct perspective distortion using OpenCV, and use intuitive tools to create 3D geometry.

## Tech Stack

- **Three.js 0.160.0** - 3D rendering
- **OpenCV.js 4.5.4** - Perspective correction
- **Vite** - Build tool
- **JSZip** - Export bundling
- **IndexedDB** - Persistent storage

---

## Features Overview

### Image Import & Perspective Correction
- Import images from device or camera
- 4-point perspective alignment with live preview
- Aspect ratio adjustment (0.5x - 2.0x)
- Pinch-to-zoom and pan on mobile
- Skip option to use original image

### 3D Modeling Tools
- **Select** - Click faces to select, shift-click for multi-select
- **Cut** - Slice faces with edge-to-edge or face-to-face lines
- **Extrude** - Pull faces outward or inward along their normal
- **Inset** - Create inner faces with uniform thickness

### Navigation
- Orbit camera (left-drag)
- Pan (middle/right-drag)
- Zoom (scroll wheel)
- **Shift + drag** to snap to nearest axis (front, back, left, right, top, bottom)
- Camera reset button
- Grid toggle

### Rendering Modes
- X-Ray mode (semi-transparent mesh)
- Wireframe visualization

### Export
- OBJ format with UVs and normals
- MTL material file
- PNG texture
- ZIP bundle for download

### Quality of Life
- Undo/Redo (up to 50 states)
- Auto-save to IndexedDB
- Auto-load on startup
- Recent images history (up to 9)
- Customizable keyboard shortcuts

---

## Keyboard Shortcuts

### Actions
| Key | Action |
|-----|--------|
| I | Import image |
| Space | Confirm action |
| S | Skip action |
| Z | Undo |
| X | Redo |

### Tools
| Key | Action |
|-----|--------|
| P | Perspective mode |
| C | Cut mode (double-tap to toggle edge/face mode) |
| E | Extrude mode |
| F | Inset mode (double-tap to toggle grouped/individual) |

### Scene
| Key | Action |
|-----|--------|
| J | Reset camera |
| K | Toggle grid |
| 1-9 | Load recent image |
| Shift (while rotating) | Snap to nearest axis |

---

## Tool Modes

### Cut Tool
- **Edge Mode** (default): Click on edges to define cut endpoints
- **Face Mode**: Click anywhere on faces to draw cut lines

### Inset Tool
- **Grouped Mode** (default): Selected faces inset as unified region (shared edges don't get side faces)
- **Individual Mode**: Each face insets separately (all edges get side faces)

---

## OpenCV Perspective Correction

The perspective correction system uses OpenCV.js to transform arbitrary quadrilaterals into rectangles.

### Algorithm

**File:** `src/perspective/dewarp.js`

```javascript
perspectiveTransform(points, img, canvasWidth, canvasHeight, ratioScale = 1.0)
```

#### Process

1. **Scale Points**: Convert canvas coordinates to image coordinates
   ```javascript
   const scaleX = img.width / canvasWidth;
   const scaleY = img.height / canvasHeight;
   const scaledPoints = points.map(p => ({
     x: p.x * scaleX,
     y: p.y * scaleY
   }));
   ```

2. **Sort Points**: Ensure consistent ordering [TL, TR, BR, BL]
   ```javascript
   // Sort by Y coordinate (top vs bottom)
   const sorted = [...scaledPoints].sort((a, b) => a.y - b.y);
   const topPoints = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
   const bottomPoints = sorted.slice(2, 4).sort((a, b) => a.x - b.x);

   const orderedPoints = [
     topPoints[0],     // Top-left
     topPoints[1],     // Top-right
     bottomPoints[1],  // Bottom-right
     bottomPoints[0]   // Bottom-left
   ];
   ```

3. **Calculate Output Dimensions**:
   ```javascript
   // Width: max of top edge and bottom edge
   const widthTop = distance(orderedPoints[0], orderedPoints[1]);
   const widthBottom = distance(orderedPoints[3], orderedPoints[2]);
   const outputWidth = Math.max(widthTop, widthBottom);

   // Height: max of left edge and right edge, scaled by ratio
   const heightLeft = distance(orderedPoints[0], orderedPoints[3]);
   const heightRight = distance(orderedPoints[1], orderedPoints[2]);
   const outputHeight = Math.max(heightLeft, heightRight) * ratioScale;
   ```

4. **Create Transformation Matrices**:
   ```javascript
   // Source quad (user's 4 points)
   const srcQuad = cv.matFromArray(4, 1, cv.CV_32FC2, [
     orderedPoints[0].x, orderedPoints[0].y,
     orderedPoints[1].x, orderedPoints[1].y,
     orderedPoints[2].x, orderedPoints[2].y,
     orderedPoints[3].x, orderedPoints[3].y
   ]);

   // Destination quad (output rectangle)
   const dstQuad = cv.matFromArray(4, 1, cv.CV_32FC2, [
     0, 0,
     outputWidth, 0,
     outputWidth, outputHeight,
     0, outputHeight
   ]);
   ```

5. **Compute Perspective Matrix**:
   ```javascript
   const perspectiveMatrix = cv.getPerspectiveTransform(srcQuad, dstQuad);
   ```

6. **Apply Warp**:
   ```javascript
   const src = cv.imread(imageCanvas);
   const dst = new cv.Mat();
   const dsize = new cv.Size(outputWidth, outputHeight);

   cv.warpPerspective(
     src,                        // Source image
     dst,                        // Destination
     perspectiveMatrix,          // Transform matrix
     dsize,                      // Output size
     cv.INTER_LINEAR,            // Interpolation method
     cv.BORDER_CONSTANT,         // Border handling
     new cv.Scalar(0, 0, 0, 0)   // Border color (transparent)
   );

   cv.imshow(outputCanvas, dst);
   ```

7. **Cleanup**:
   ```javascript
   src.delete();
   dst.delete();
   srcQuad.delete();
   dstQuad.delete();
   perspectiveMatrix.delete();
   ```

### Safety Features

- **Size Cap**: Maximum output dimension of 5000px to prevent browser crashes
- **Ratio Limits**: Aspect ratio adjustment capped at 0.5x - 2.0x
- **Fallback**: Returns original image if OpenCV fails
- **Resource Cleanup**: All OpenCV Mat objects explicitly deleted

### UI: Alignment Panel

**File:** `src/perspective/alignPanel.js`

**Split-view Interface:**
- Left panel: Source image with draggable corner points
- Right panel: 3D viewport with live preview

**Interactions:**
- Tap to place corner points (4 required)
- Drag points to adjust
- Pinch-to-zoom / mouse wheel zoom
- Pan with two-finger drag or middle-click
- Ratio slider for height adjustment

**Controls:**
- **Confirm** (enabled after 4 points): Apply transformation
- **Skip**: Use original image
- **Clear**: Remove all points
- **Reset View**: Reset zoom/pan

---

## Geometry System

### Face-Based Representation

**File:** `src/geometry/face.js`

```javascript
class Face {
  constructor(id, vertices, uvs) {
    this.id = id;              // Unique identifier
    this.vertices = vertices;  // Array of THREE.Vector3
    this.uvs = uvs;            // Array of THREE.Vector2
    this.normal = null;        // Calculated face normal
    this.selected = false;     // Selection state
  }

  getCenter()          // Returns centroid
  clone()              // Deep copy
  getEdges()           // Returns edge pairs with indices
  calculateNormal()    // Cross product of edges
}

class EditableMesh {
  constructor(sceneManager) {
    this.faces = [];           // Array of Face objects
    this.nextFaceId = 0;       // ID counter
    this.mesh = null;          // THREE.Mesh for rendering
    this.wireframe = null;     // Edge visualization
  }

  createFromDimensions(width, height, texture)
  serialize()          // Convert to JSON
  deserialize(data)    // Restore from JSON
  rebuildMesh()        // Update Three.js geometry
  mergeVertices()      // Weld coincident vertices
}
```

### Cut Operation

**File:** `src/geometry/cut.js`

Splits faces with edge-to-edge lines using 3D cutting planes.

```javascript
// Find intersection of cutting plane with face edges
function planeEdgeIntersection(plane, lineStart, lineEnd) {
  const direction = new THREE.Vector3().subVectors(lineEnd, lineStart);
  const denominator = plane.normal.dot(direction.normalize());

  if (Math.abs(denominator) < 0.00001) return null; // Parallel

  const t = -(plane.normal.dot(lineStart) + plane.constant) / denominator;
  if (t < 0.001 || t > 0.999) return null; // Outside segment

  return {
    point: lineStart.clone().addScaledVector(direction, t),
    t: t
  };
}

// Create cutting plane from screen line and camera direction
function sliceMesh(faces, startPoint, endPoint, cameraDirection) {
  const cutDirection = new THREE.Vector3()
    .subVectors(endPoint, startPoint)
    .normalize();

  const planeNormal = new THREE.Vector3()
    .crossVectors(cutDirection, cameraDirection)
    .normalize();

  const plane = new THREE.Plane()
    .setFromNormalAndCoplanarPoint(planeNormal, startPoint);

  // Find all faces intersected by plane
  // Split each face at intersection points
  // Return new face array
}
```

### Extrude Operation

**File:** `src/geometry/extrude.js`

Pulls faces outward along their normal.

```javascript
function extrudeFace(face, distance, nextFaceId) {
  const normal = face.calculateNormal();

  // Create offset vertices
  const newVertices = face.vertices.map(v =>
    v.clone().addScaledVector(normal, distance)
  );

  // Create extruded top face
  const topFace = new Face(face.id, newVertices, face.uvs.map(uv => uv.clone()));

  // Create side faces for each edge
  const sideFaces = [];
  for (let i = 0; i < face.vertices.length; i++) {
    const next = (i + 1) % face.vertices.length;

    sideFaces.push(new Face(nextFaceId++, [
      face.vertices[i].clone(),
      face.vertices[next].clone(),
      newVertices[next].clone(),
      newVertices[i].clone()
    ], [
      face.uvs[i].clone(),
      face.uvs[next].clone(),
      face.uvs[next].clone(),
      face.uvs[i].clone()
    ]));
  }

  return { topFace, sideFaces };
}
```

### Inset Operation

**File:** `src/geometry/inset.js`

Creates inner faces with uniform edge distance.

```javascript
function insetFace(face, distance, nextFaceId) {
  const normal = face.calculateNormal();
  const center = face.getCenter();

  // Calculate inset vertices using edge bisectors
  const insetVertices = face.vertices.map((vertex, i) => {
    const prev = face.vertices[(i - 1 + face.vertices.length) % face.vertices.length];
    const next = face.vertices[(i + 1) % face.vertices.length];

    // Edge directions
    const edge1 = new THREE.Vector3().subVectors(vertex, prev).normalize();
    const edge2 = new THREE.Vector3().subVectors(next, vertex).normalize();

    // Edge normals (perpendicular to edges, in face plane)
    const normal1 = new THREE.Vector3().crossVectors(normal, edge1);
    const normal2 = new THREE.Vector3().crossVectors(normal, edge2);

    // Bisector direction
    const bisector = new THREE.Vector3().addVectors(normal1, normal2).normalize();

    // Scale factor for uniform perpendicular distance
    const scale = distance / Math.cos(Math.acos(normal1.dot(bisector)));

    return vertex.clone().addScaledVector(bisector, scale);
  });

  // Create center face and side faces
  // ...
}
```

---

## Storage System

### Auto-Save (IndexedDB)

**File:** `src/storage/local.js`

```javascript
class StorageManager {
  constructor(dbName = 'LazyImage_DB', storeName = 'projects') {
    this.dbReady = this.initDB();
  }

  async save(state) {
    await this.dbReady;
    // Store: { version, timestamp, state: { hasImage, hasMesh, imageData, mesh } }
  }

  async load() {
    await this.dbReady;
    // Returns saved state or null
  }
}
```

**Triggers:**
- After perspective correction
- After cut/extrude/inset operations
- After undo/redo

**State Structure:**
```javascript
{
  version: 1,
  timestamp: Date.now(),
  state: {
    hasImage: boolean,
    hasMesh: boolean,
    imageData: string,  // PNG data URL
    mesh: {
      faces: [...],     // Serialized faces
      nextFaceId: number
    }
  }
}
```

---

## Export System

**File:** `src/export/obj.js`

Exports model as OBJ + MTL + texture in a ZIP file.

### OBJ Format
```
# Exported from ImageModel
mtllib model.mtl
o model

# Vertices
v 0.0 0.0 0.0
v 1.0 0.0 0.0
...

# Texture Coordinates
vt 0.0 0.0
vt 1.0 0.0
...

# Normals (one per face)
vn 0.0 0.0 1.0
...

# Faces
usemtl model_material
f 1/1/1 2/2/1 3/3/1 4/4/1
...
```

### MTL Format
```
newmtl model_material
map_Kd model.png
Kd 1.0 1.0 1.0
```

---

## Project Structure

```
src/
├── main.js                 # App orchestration
├── scene.js                # Three.js scene setup
├── geometry/
│   ├── plane.js            # Image plane loading
│   ├── face.js             # Face & EditableMesh classes
│   ├── extrude.js          # Extrude operations
│   ├── inset.js            # Inset operations
│   └── cut.js              # Cut operations
├── perspective/
│   ├── dewarp.js           # OpenCV perspective transform
│   └── alignPanel.js       # Alignment UI panel
├── tools/
│   ├── modes.js            # Mode definitions
│   ├── toolbar.js          # UI toolbar
│   ├── shortcuts.js        # Keyboard shortcuts
│   └── select.js           # Selection tool
├── storage/
│   └── local.js            # IndexedDB storage
├── history/
│   └── undo.js             # Undo/redo manager
├── render/
│   └── settings.js         # X-ray mode
└── export/
    └── obj.js              # OBJ/MTL export
```

---

## Mobile Controls

### Touch Gestures
- **Single tap**: Select face / place point
- **Double tap**: Deselect all
- **Single finger drag**: Rotate view
- **Two finger pinch**: Zoom
- **Two finger drag**: Pan
- **Long press + drag**: Context-specific (extrude distance, inset thickness)

### Pinch-to-Zoom in Cut Mode
When in cut mode, pinch gestures are detected and passed through to the camera controls, allowing you to zoom while positioning cut lines.

---

## Navigation: Shift-to-Snap

While rotating the camera with mouse drag, press **Shift** to snap to the nearest axis-aligned view:

- **Front**: Camera at +Z, looking at origin
- **Back**: Camera at -Z, looking at origin
- **Right**: Camera at +X, looking at origin
- **Left**: Camera at -X, looking at origin
- **Top**: Camera at +Y, looking at origin
- **Bottom**: Camera at -Y, looking at origin

The snap includes a smooth 200ms animation with ease-out easing.

---

## License

[Add your license here]
