import * as THREE from 'three';

/**
 * Face-based mesh representation
 * Easier to work with for cutting and extrusion than raw triangles
 */

/**
 * A single face (quad or triangle) in the mesh
 */
export class Face {
  constructor(id, vertices, uvs) {
    this.id = id;
    this.vertices = vertices; // Array of Vector3
    this.uvs = uvs;           // Array of Vector2
    this.normal = null;
    this.selected = false;

    this.calculateNormal();
  }

  /**
   * Calculate face normal
   */
  calculateNormal() {
    if (this.vertices.length < 3) return;

    const v0 = this.vertices[0];
    const v1 = this.vertices[1];
    const v2 = this.vertices[2];

    const edge1 = new THREE.Vector3().subVectors(v1, v0);
    const edge2 = new THREE.Vector3().subVectors(v2, v0);

    this.normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
  }

  /**
   * Get the center point of the face
   * @returns {THREE.Vector3}
   */
  getCenter() {
    const center = new THREE.Vector3();
    this.vertices.forEach(v => center.add(v));
    center.divideScalar(this.vertices.length);
    return center;
  }

  /**
   * Clone the face
   * @returns {Face}
   */
  clone() {
    const newVertices = this.vertices.map(v => v.clone());
    const newUVs = this.uvs.map(uv => uv.clone());
    const face = new Face(this.id, newVertices, newUVs);
    face.selected = this.selected;
    return face;
  }

  /**
   * Get edges of the face
   * @returns {Array<{start: THREE.Vector3, end: THREE.Vector3, index: number}>}
   */
  getEdges() {
    const edges = [];
    const count = this.vertices.length;

    for (let i = 0; i < count; i++) {
      edges.push({
        start: this.vertices[i],
        end: this.vertices[(i + 1) % count],
        startIndex: i,
        endIndex: (i + 1) % count
      });
    }

    return edges;
  }
}

/**
 * Face-based mesh that can be edited
 */
export class EditableMesh {
  constructor() {
    this.faces = [];
    this.nextFaceId = 0;
    this.texture = null;
    this.mesh = null; // Three.js mesh
    this.wireframe = null; // Wireframe overlay
    this.triangleToFace = []; // Maps triangle index to Face object

    // Wireframe material - depth tested so back-facing wireframes are occluded
    this.wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0xFF9900,  // ImageEdge color from design
      linewidth: 2,
      transparent: true,
      opacity: 0.5,
      depthTest: true,   // Test against depth buffer (occlude behind geometry)
      depthWrite: false  // Don't write to depth buffer (wireframes don't occlude each other)
    });
  }

  /**
   * Create a simple quad mesh from dimensions
   * Centered on origin in XY plane
   * @param {number} width
   * @param {number} height
   * @param {THREE.Texture} texture
   */
  createFromDimensions(width, height, texture) {
    this.texture = texture;

    // Create a single quad face - CENTERED on origin
    const halfW = width / 2;
    const halfH = height / 2;

    // Vertices in XY plane, centered at origin
    const vertices = [
      new THREE.Vector3(-halfW, -halfH, 0), // Bottom-left
      new THREE.Vector3(halfW, -halfH, 0),  // Bottom-right
      new THREE.Vector3(halfW, halfH, 0),   // Top-right
      new THREE.Vector3(-halfW, halfH, 0)   // Top-left
    ];

    const uvs = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(1, 0),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(0, 1)
    ];

    const face = new Face(this.nextFaceId++, vertices, uvs);
    this.faces.push(face);

    this.rebuildMesh();
  }

  /**
   * Rebuild the Three.js mesh from faces
   */
  rebuildMesh() {
    // Dispose old mesh geometry
    if (this.mesh) {
      this.mesh.geometry.dispose();
    }

    // Dispose old wireframe
    if (this.wireframe) {
      this.wireframe.geometry.dispose();
    }

    // Build geometry from faces
    const positions = [];
    const uvs = [];
    const indices = [];
    this.triangleToFace = []; // Reset triangle-to-face mapping

    let vertexIndex = 0;

    this.faces.forEach(face => {
      const startIndex = vertexIndex;

      // Add vertices
      face.vertices.forEach((v, i) => {
        positions.push(v.x, v.y, v.z);
        uvs.push(face.uvs[i].x, face.uvs[i].y);
        vertexIndex++;
      });

      // Triangulate the face (fan triangulation for convex polygons)
      const count = face.vertices.length;
      for (let i = 1; i < count - 1; i++) {
        indices.push(startIndex, startIndex + i, startIndex + i + 1);
        this.triangleToFace.push(face); // Map this triangle to its face
      }
    });

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Create or update mesh
    if (!this.mesh) {
      // Create material - use MeshBasicMaterial for correct color handling
      const material = new THREE.MeshBasicMaterial({
        map: this.texture,
        side: THREE.DoubleSide
      });

      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.name = 'editableMesh';
      this.mesh.userData.editableMesh = this;
    } else {
      this.mesh.geometry = geometry;
    }

    // Build wireframe from face edges
    this.rebuildWireframe();

    return this.mesh;
  }

  /**
   * Create a material that darkens the back face (50% opacity overlay)
   * @param {THREE.Texture} texture
   * @returns {THREE.ShaderMaterial}
   */
  createBackfaceDarkenMaterial(texture) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        backfaceOpacity: { value: 0.5 }  // 50% darkening on back face
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform float backfaceOpacity;
        varying vec2 vUv;

        void main() {
          vec4 texColor = texture2D(map, vUv);

          // Check if this is the back face
          if (!gl_FrontFacing) {
            // Darken the back face with black overlay
            texColor.rgb = mix(texColor.rgb, vec3(0.0), backfaceOpacity);
          }

          gl_FragColor = texColor;
        }
      `,
      side: THREE.DoubleSide,
      transparent: false
    });

    return material;
  }

  /**
   * Rebuild the wireframe overlay
   */
  rebuildWireframe() {
    // Build wireframe lines from face edges
    // Offset slightly along face normal to prevent z-fighting with mesh surface
    const wireframePositions = [];
    const normalOffset = 0.001; // Small offset to prevent z-fighting

    this.faces.forEach(face => {
      const normal = face.normal;
      const offset = {
        x: normal.x * normalOffset,
        y: normal.y * normalOffset,
        z: normal.z * normalOffset
      };

      const edges = face.getEdges();
      edges.forEach(edge => {
        wireframePositions.push(
          edge.start.x + offset.x, edge.start.y + offset.y, edge.start.z + offset.z,
          edge.end.x + offset.x, edge.end.y + offset.y, edge.end.z + offset.z
        );
      });
    });

    const wireframeGeometry = new THREE.BufferGeometry();
    wireframeGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(wireframePositions, 3)
    );

    if (!this.wireframe) {
      this.wireframe = new THREE.LineSegments(wireframeGeometry, this.wireframeMaterial);
      this.wireframe.name = 'meshWireframe';
      this.wireframe.renderOrder = 1; // Render after mesh
    } else {
      this.wireframe.geometry.dispose();
      this.wireframe.geometry = wireframeGeometry;
    }

    return this.wireframe;
  }

  /**
   * Get the wireframe object
   * @returns {THREE.LineSegments}
   */
  getWireframe() {
    return this.wireframe;
  }

  /**
   * Find face by triangle index from raycast
   * @param {number} triangleIndex - The faceIndex from raycast intersection
   * @returns {Face|null}
   */
  findFaceByTriangleIndex(triangleIndex) {
    if (triangleIndex >= 0 && triangleIndex < this.triangleToFace.length) {
      return this.triangleToFace[triangleIndex];
    }
    return null;
  }

  /**
   * Find which face contains a given point
   * @param {THREE.Vector3} point
   * @param {number} [triangleIndex] - Optional triangle index from raycast for direct lookup
   * @returns {Face|null}
   */
  findFaceAtPoint(point, triangleIndex) {
    // If we have a triangle index, use direct lookup (most accurate)
    if (triangleIndex !== undefined && triangleIndex >= 0) {
      const face = this.findFaceByTriangleIndex(triangleIndex);
      if (face) return face;
    }

    // Fallback to point-in-polygon test
    for (const face of this.faces) {
      if (this.isPointInFace(point, face)) {
        return face;
      }
    }
    return null;
  }

  /**
   * Check if a point is inside a face (2D test in face plane)
   */
  isPointInFace(point, face) {
    // Simplified - assumes face is roughly planar
    // Project to 2D based on dominant axis of normal
    const normal = face.normal;
    let axis1, axis2;

    if (Math.abs(normal.z) > Math.abs(normal.x) && Math.abs(normal.z) > Math.abs(normal.y)) {
      axis1 = 'x';
      axis2 = 'y';
    } else if (Math.abs(normal.y) > Math.abs(normal.x)) {
      axis1 = 'x';
      axis2 = 'z';
    } else {
      axis1 = 'y';
      axis2 = 'z';
    }

    // Point-in-polygon test using ray casting
    const px = point[axis1];
    const py = point[axis2];

    let inside = false;
    const n = face.vertices.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = face.vertices[i][axis1];
      const yi = face.vertices[i][axis2];
      const xj = face.vertices[j][axis1];
      const yj = face.vertices[j][axis2];

      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Select a face
   * @param {Face} face
   */
  selectFace(face) {
    // Deselect all first
    this.faces.forEach(f => f.selected = false);

    if (face) {
      face.selected = true;
    }
  }

  /**
   * Get selected face
   * @returns {Face|null}
   */
  getSelectedFace() {
    return this.faces.find(f => f.selected) || null;
  }

  /**
   * Get all faces
   * @returns {Array<Face>}
   */
  getFaces() {
    return this.faces;
  }

  /**
   * Get face by ID
   * @param {number} id
   * @returns {Face|null}
   */
  getFaceById(id) {
    return this.faces.find(f => f.id === id) || null;
  }

  /**
   * Serialize mesh state for undo/redo
   * @returns {object}
   */
  serialize() {
    return {
      faces: this.faces.map(face => ({
        id: face.id,
        vertices: face.vertices.map(v => ({ x: v.x, y: v.y, z: v.z })),
        uvs: face.uvs.map(uv => ({ x: uv.x, y: uv.y })),
        selected: face.selected
      })),
      nextFaceId: this.nextFaceId
    };
  }

  /**
   * Restore mesh state from serialized data
   * @param {object} data
   */
  deserialize(data) {
    this.faces = data.faces.map(faceData => {
      const vertices = faceData.vertices.map(v => new THREE.Vector3(v.x, v.y, v.z));
      const uvs = faceData.uvs.map(uv => new THREE.Vector2(uv.x, uv.y));
      const face = new Face(faceData.id, vertices, uvs);
      face.selected = faceData.selected;
      return face;
    });
    this.nextFaceId = data.nextFaceId;
    this.rebuildMesh();
  }

  /**
   * Dispose resources
   */
  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
    if (this.wireframe) {
      this.wireframe.geometry.dispose();
    }
    if (this.wireframeMaterial) {
      this.wireframeMaterial.dispose();
    }
  }

  /**
   * Merge vertices that are at the same position (within tolerance)
   * This reduces duplicate vertices created by cuts and other operations
   * @param {number} [tolerance=0.00001] - Maximum distance to consider vertices as the same
   * @returns {number} - Number of vertices merged
   */
  mergeVertices(tolerance = 0.00001) {
    // Build a spatial hash map of unique vertex positions
    const precision = Math.round(1 / tolerance);
    const vertexMap = new Map(); // key -> { vertex: THREE.Vector3, refs: [{face, index}] }

    // Helper to create a position key
    const posKey = (v) => {
      return `${Math.round(v.x * precision)},${Math.round(v.y * precision)},${Math.round(v.z * precision)}`;
    };

    // Collect all vertex references
    this.faces.forEach(face => {
      face.vertices.forEach((v, i) => {
        const key = posKey(v);
        if (!vertexMap.has(key)) {
          vertexMap.set(key, { vertex: v, refs: [] });
        }
        vertexMap.get(key).refs.push({ face, index: i });
      });
    });

    // Merge vertices - make all refs point to the same vertex instance
    let mergeCount = 0;

    vertexMap.forEach(({ vertex, refs }) => {
      if (refs.length > 1) {
        // Multiple faces reference this position - merge them
        // Calculate average position for better precision
        const avgPos = new THREE.Vector3();
        refs.forEach(ref => avgPos.add(ref.face.vertices[ref.index]));
        avgPos.divideScalar(refs.length);

        // Create the canonical vertex at the average position
        const mergedVertex = new THREE.Vector3(avgPos.x, avgPos.y, avgPos.z);

        // Update all face references to use the same vertex instance
        refs.forEach(ref => {
          ref.face.vertices[ref.index] = mergedVertex;
        });

        mergeCount += refs.length - 1;
      }
    });

    // Recalculate normals after merging
    this.faces.forEach(face => face.calculateNormal());

    return mergeCount;
  }
}
