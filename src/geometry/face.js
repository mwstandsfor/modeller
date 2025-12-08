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

    // Wireframe material - renders on top with depth test disabled
    this.wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      linewidth: 2,
      transparent: true,
      opacity: 1.0,
      depthTest: false  // Always render on top
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
      // Create material with back-face darkening
      const material = this.createBackfaceDarkenMaterial(this.texture);

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
    const wireframePositions = [];

    this.faces.forEach(face => {
      const edges = face.getEdges();
      edges.forEach(edge => {
        wireframePositions.push(
          edge.start.x, edge.start.y, edge.start.z,
          edge.end.x, edge.end.y, edge.end.z
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
      this.wireframe.renderOrder = 1; // Render on top
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
   * Find which face contains a given point
   * @param {THREE.Vector3} point
   * @returns {Face|null}
   */
  findFaceAtPoint(point) {
    // Use raycasting in local space
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
}
