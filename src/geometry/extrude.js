import * as THREE from 'three';
import { Face } from './face.js';
import { handleFaceSelection, createEmptySpaceHandler } from '../tools/selection.js';

/**
 * Create a canonical edge key for comparison (order-independent)
 * @param {THREE.Vector3} v1
 * @param {THREE.Vector3} v2
 * @returns {string}
 */
function edgeKey(v1, v2) {
  const precision = 1000000;
  const p1 = `${Math.round(v1.x * precision)},${Math.round(v1.y * precision)},${Math.round(v1.z * precision)}`;
  const p2 = `${Math.round(v2.x * precision)},${Math.round(v2.y * precision)},${Math.round(v2.z * precision)}`;
  // Sort to make order-independent
  return p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
}

/**
 * Extrude a face along its normal
 * Creates side faces connecting the original and extruded face
 *
 * @param {Face} face - Face to extrude
 * @param {number} distance - Extrusion distance (positive = outward, negative = inward)
 * @param {number} nextFaceId - Starting ID for new faces
 * @returns {{extrudedFace: Face, sideFaces: Face[], originalFace: Face}}
 */
export function extrudeFace(face, distance, nextFaceId) {
  const normal = face.normal.clone();
  const offset = normal.multiplyScalar(distance);

  // Create extruded face (moved copy of original)
  const extrudedVertices = face.vertices.map(v => v.clone().add(offset));
  const extrudedUVs = face.uvs.map(uv => uv.clone());

  const extrudedFace = new Face(face.id, extrudedVertices, extrudedUVs);

  // Create side faces connecting original and extruded
  const sideFaces = [];
  const n = face.vertices.length;

  for (let i = 0; i < n; i++) {
    const nextI = (i + 1) % n;

    // Four corners of the side quad
    // Wind counter-clockwise for outward-facing normal
    const v0 = face.vertices[i].clone();
    const v1 = face.vertices[nextI].clone();
    const v2 = extrudedVertices[nextI].clone();
    const v3 = extrudedVertices[i].clone();

    // UV mapping for sides (simple planar projection)
    // Map based on position along edge and extrusion depth
    const edgeLength = v0.distanceTo(v1);
    const uScale = edgeLength / 2; // Normalize to reasonable UV space

    const sideUVs = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(uScale, 0),
      new THREE.Vector2(uScale, Math.abs(distance)),
      new THREE.Vector2(0, Math.abs(distance))
    ];

    const sideFace = new Face(nextFaceId++, [v0, v1, v2, v3], sideUVs);
    sideFaces.push(sideFace);
  }

  // The original face position stays (it becomes the "back" of the extrusion)
  // But we return it so it can be removed if needed
  const originalFace = new Face(nextFaceId++, face.vertices.map(v => v.clone()), face.uvs.map(uv => uv.clone()));

  return {
    extrudedFace,
    sideFaces,
    originalFace,
    nextFaceId
  };
}

/**
 * Extrude multiple faces together, only creating side faces along the outer perimeter
 * Shared edges between selected faces don't get side faces (avoids internal geometry)
 *
 * @param {Face[]} faces - Faces to extrude
 * @param {number} distance - Extrusion distance
 * @param {number} nextFaceId - Starting ID for new faces
 * @returns {{extrudedFaces: Face[], sideFaces: Face[], nextFaceId: number}}
 */
export function extrudeFaces(faces, distance, nextFaceId) {
  if (faces.length === 0) {
    return { extrudedFaces: [], sideFaces: [], nextFaceId };
  }

  // Calculate average normal for consistent extrusion direction
  const avgNormal = new THREE.Vector3();
  faces.forEach(face => avgNormal.add(face.normal));
  avgNormal.normalize();
  const offset = avgNormal.clone().multiplyScalar(distance);

  // Count edge occurrences across all faces
  const edgeCounts = new Map();
  const edgeData = new Map(); // Store edge data for creating side faces

  faces.forEach(face => {
    const n = face.vertices.length;
    for (let i = 0; i < n; i++) {
      const nextI = (i + 1) % n;
      const v0 = face.vertices[i];
      const v1 = face.vertices[nextI];
      const key = edgeKey(v0, v1);

      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);

      // Store edge data (keep the first occurrence's vertex order for winding)
      if (!edgeData.has(key)) {
        edgeData.set(key, { v0: v0.clone(), v1: v1.clone() });
      }
    }
  });

  // Create extruded faces
  const extrudedFaces = [];
  const extrudedVertexMap = new Map(); // Map original vertex position to extruded vertex

  faces.forEach(face => {
    const extrudedVertices = face.vertices.map(v => {
      const key = `${v.x},${v.y},${v.z}`;
      if (!extrudedVertexMap.has(key)) {
        extrudedVertexMap.set(key, v.clone().add(offset));
      }
      return extrudedVertexMap.get(key).clone();
    });
    const extrudedUVs = face.uvs.map(uv => uv.clone());

    const extrudedFace = new Face(face.id, extrudedVertices, extrudedUVs);
    extrudedFaces.push(extrudedFace);
  });

  // Create side faces only for perimeter edges (edges that appear once)
  const sideFaces = [];

  faces.forEach(face => {
    const n = face.vertices.length;
    for (let i = 0; i < n; i++) {
      const nextI = (i + 1) % n;
      const v0 = face.vertices[i];
      const v1 = face.vertices[nextI];
      const key = edgeKey(v0, v1);

      // Only create side face if edge is on the perimeter (appears once)
      if (edgeCounts.get(key) === 1) {
        const v0Key = `${v0.x},${v0.y},${v0.z}`;
        const v1Key = `${v1.x},${v1.y},${v1.z}`;

        const extV0 = extrudedVertexMap.get(v0Key);
        const extV1 = extrudedVertexMap.get(v1Key);

        // Four corners of the side quad
        const sideVerts = [
          v0.clone(),
          v1.clone(),
          extV1.clone(),
          extV0.clone()
        ];

        // UV mapping for sides
        const edgeLength = v0.distanceTo(v1);
        const uScale = edgeLength / 2;

        const sideUVs = [
          new THREE.Vector2(0, 0),
          new THREE.Vector2(uScale, 0),
          new THREE.Vector2(uScale, Math.abs(distance)),
          new THREE.Vector2(0, Math.abs(distance))
        ];

        const sideFace = new Face(nextFaceId++, sideVerts, sideUVs);
        sideFaces.push(sideFace);
      }
    }
  });

  return {
    extrudedFaces,
    sideFaces,
    nextFaceId
  };
}

/**
 * Extrusion tool handler
 * Tap+drag workflow: tap selects face with gizmo, drag extrudes, release confirms
 * Supports multi-selection via SelectTool
 */
export class ExtrudeTool {
  constructor(sceneManager, selectTool = null) {
    this.sceneManager = sceneManager;
    this.selectTool = selectTool;
    this.editableMesh = null;
    this.selectedFaces = [];  // Array for multi-selection

    this.isExtruding = false;
    this.isDragging = false;
    this.startY = 0;
    this.startX = 0;
    this.currentDistance = 0;
    this.dragThreshold = 5;  // pixels before drag starts

    // Preview meshes for extrusion
    this.previewMeshes = [];
    this.previewWireframes = [];

    // Normal gizmo
    this.gizmo = null;
    this.gizmoLength = 32;  // pixels

    // Material for side faces (semi-transparent, always visible for inward extrusion)
    this.sideMaterial = new THREE.MeshBasicMaterial({
      color: 0xB68133,  // Match selection color
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthTest: false
    });

    // Material for front face (more opaque to show where new face will be)
    this.frontMaterial = new THREE.MeshBasicMaterial({
      color: 0xB68133,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthTest: false
    });

    // Wireframe material for preview edges
    this.wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0xFF9900,  // SelectionBorder color
      linewidth: 2,
      depthTest: false
    });

    // Gizmo material
    this.gizmoMaterial = new THREE.LineBasicMaterial({
      color: 0xFF9900,
      linewidth: 3,
      depthTest: false
    });

    // Callbacks
    this.onExtrudeComplete = null;
    this.onFaceSelected = null;  // Called when face is tapped

    // Sensitivity
    this.sensitivity = 0.01;

    // Double-tap on empty space handler
    this.emptySpaceHandler = createEmptySpaceHandler();

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
  }

  setMesh(editableMesh) {
    this.editableMesh = editableMesh;
  }

  setSelectedFaces(faces) {
    this.selectedFaces = faces || [];
    this.removeGizmo();
    if (this.selectedFaces.length > 0) {
      this.createGizmo();
    }
  }

  activate(canvas) {
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointerleave', this.handlePointerUp);

    // Enable controls for wheel zoom
    this.sceneManager.setControlsEnabled(true);

    // Show gizmo if faces already selected
    if (this.selectedFaces.length > 0) {
      this.createGizmo();
    }
  }

  deactivate() {
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
      this.canvas.removeEventListener('pointermove', this.handlePointerMove);
      this.canvas.removeEventListener('pointerup', this.handlePointerUp);
      this.canvas.removeEventListener('pointerleave', this.handlePointerUp);
    }
    this.removePreview();
    this.removeGizmo();
  }

  /**
   * Create normal gizmo for selected faces (32px orange line)
   */
  createGizmo() {
    this.removeGizmo();
    if (this.selectedFaces.length === 0) return;

    // Calculate center and average normal of selected faces
    const center = new THREE.Vector3();
    const avgNormal = new THREE.Vector3();

    this.selectedFaces.forEach(face => {
      center.add(face.getCenter());
      avgNormal.add(face.normal);
    });
    center.divideScalar(this.selectedFaces.length);
    avgNormal.normalize();

    // Convert 32px to world space length
    const worldLength = this.pixelsToWorldLength(center, this.gizmoLength);

    // Create line from center along normal
    const endPoint = center.clone().add(avgNormal.clone().multiplyScalar(worldLength));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      center.x, center.y, center.z,
      endPoint.x, endPoint.y, endPoint.z
    ], 3));

    this.gizmo = new THREE.Line(geometry, this.gizmoMaterial);
    this.gizmo.renderOrder = 1000;
    this.sceneManager.add(this.gizmo);
  }

  removeGizmo() {
    if (this.gizmo) {
      this.sceneManager.remove(this.gizmo);
      this.gizmo.geometry.dispose();
      this.gizmo = null;
    }
  }

  /**
   * Convert pixel length to world space length at a given point
   */
  pixelsToWorldLength(worldPoint, pixelLength) {
    const camera = this.sceneManager.camera;

    // Project point to screen
    const projected = worldPoint.clone().project(camera);

    // Create offset point in screen space
    const canvas = this.sceneManager.renderer.domElement;
    const offsetX = (pixelLength / canvas.clientWidth) * 2;

    // Unproject both points
    const p1 = new THREE.Vector3(projected.x, projected.y, projected.z).unproject(camera);
    const p2 = new THREE.Vector3(projected.x + offsetX, projected.y, projected.z).unproject(camera);

    return p1.distanceTo(p2);
  }

  /**
   * Find face at screen position
   */
  findFaceAtPoint(clientX, clientY) {
    if (!this.editableMesh) return null;

    const ndc = this.sceneManager.screenToNDC(clientX, clientY);
    const raycaster = this.sceneManager.getRaycaster(ndc.x, ndc.y);
    const intersects = raycaster.intersectObject(this.editableMesh.mesh);

    if (intersects.length === 0) return null;

    const point = intersects[0].point;
    const triangleIndex = intersects[0].faceIndex;
    return this.editableMesh.findFaceAtPoint(point, triangleIndex);
  }

  handlePointerDown(e) {
    if (!this.editableMesh) return;

    this.startX = e.clientX;
    this.startY = e.clientY;
    this.isDragging = false;
    this.isExtruding = false;
    this.currentDistance = 0;

    // Find face under cursor
    const face = this.findFaceAtPoint(e.clientX, e.clientY);

    if (!face) {
      // Clicking on empty space - check for double-tap to clear selection
      if (this.emptySpaceHandler.checkDoubleTap(this.selectedFaces, this.selectTool, this.onFaceSelected)) {
        this.removeGizmo();
      }
      // Allow 3D rotation
      this.sceneManager.setControlsEnabled(true);
      return;
    }

    // Reset empty space tap timer when clicking on a face
    this.emptySpaceHandler.reset();

    // Disable orbit controls
    this.sceneManager.setControlsEnabled(false);

    // Handle selection (supports shift-click for multi-select)
    handleFaceSelection(e, face, this.selectedFaces, this.selectTool, this.onFaceSelected);

    // Update gizmo
    this.createGizmo();

    // Prepare for potential drag
    this.isExtruding = true;
  }

  handlePointerMove(e) {
    if (!this.isExtruding || this.selectedFaces.length === 0) return;

    const deltaX = Math.abs(e.clientX - this.startX);
    const deltaY = Math.abs(e.clientY - this.startY);

    // Check if drag threshold exceeded
    if (!this.isDragging && (deltaX > this.dragThreshold || deltaY > this.dragThreshold)) {
      this.isDragging = true;
      // Hide selection highlight during drag
      if (this.selectTool) {
        this.selectTool.hideHighlight();
      }
      // Hide gizmo during drag
      this.removeGizmo();
    }

    if (this.isDragging) {
      const dragDelta = this.startY - e.clientY;
      this.currentDistance = dragDelta * this.sensitivity;
      this.updatePreview();
    }
  }

  handlePointerUp(e) {
    if (!this.isExtruding) return;

    this.isExtruding = false;
    this.sceneManager.setControlsEnabled(true);

    if (this.isDragging && Math.abs(this.currentDistance) > 0.01) {
      // Execute extrusion immediately on release
      if (this.onExtrudeComplete) {
        this.onExtrudeComplete([...this.selectedFaces], this.currentDistance);
      }
      this.removePreview();
      // Gizmo will be recreated when selection is updated after extrude
    } else {
      // Was just a tap (no significant drag) - keep selection, show gizmo
      this.removePreview();
      if (this.selectedFaces.length > 0) {
        this.createGizmo();
        // Restore selection highlight
        if (this.selectTool) {
          this.selectTool.showHighlight();
        }
      }
    }

    this.isDragging = false;
    this.currentDistance = 0;
  }

  updatePreview() {
    if (this.selectedFaces.length === 0) return;

    // Remove old previews
    this.removePreview();

    if (Math.abs(this.currentDistance) < 0.001) return;

    // Use extrudeFaces for correct multi-face preview (no internal side faces)
    const result = extrudeFaces(this.selectedFaces, this.currentDistance, 0);

    // Build front faces mesh (more opaque)
    const frontPositions = [];
    const frontIndices = [];

    result.extrudedFaces.forEach(extrudedFace => {
      const startIdx = frontPositions.length / 3;
      extrudedFace.vertices.forEach(v => {
        frontPositions.push(v.x, v.y, v.z);
      });
      for (let i = 1; i < extrudedFace.vertices.length - 1; i++) {
        frontIndices.push(startIdx, startIdx + i, startIdx + i + 1);
      }
    });

    const frontGeometry = new THREE.BufferGeometry();
    frontGeometry.setAttribute('position', new THREE.Float32BufferAttribute(frontPositions, 3));
    frontGeometry.setIndex(frontIndices);
    frontGeometry.computeVertexNormals();

    const frontMesh = new THREE.Mesh(frontGeometry, this.frontMaterial);
    this.sceneManager.add(frontMesh);
    this.previewMeshes.push(frontMesh);

    // Build side faces mesh (semi-transparent) - only perimeter edges
    if (result.sideFaces.length > 0) {
      const sidePositions = [];
      const sideIndices = [];

      result.sideFaces.forEach(f => {
        const startIdx = sidePositions.length / 3;
        f.vertices.forEach(v => {
          sidePositions.push(v.x, v.y, v.z);
        });
        for (let i = 1; i < f.vertices.length - 1; i++) {
          sideIndices.push(startIdx, startIdx + i, startIdx + i + 1);
        }
      });

      const sideGeometry = new THREE.BufferGeometry();
      sideGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sidePositions, 3));
      sideGeometry.setIndex(sideIndices);
      sideGeometry.computeVertexNormals();

      const sideMesh = new THREE.Mesh(sideGeometry, this.sideMaterial);
      this.sceneManager.add(sideMesh);
      this.previewMeshes.push(sideMesh);
    }

    // Build wireframe for perimeter edges only
    const wireframePositions = [];

    // Front face edges (all of them)
    result.extrudedFaces.forEach(extrudedFace => {
      const frontVerts = extrudedFace.vertices;
      for (let i = 0; i < frontVerts.length; i++) {
        const next = (i + 1) % frontVerts.length;
        wireframePositions.push(
          frontVerts[i].x, frontVerts[i].y, frontVerts[i].z,
          frontVerts[next].x, frontVerts[next].y, frontVerts[next].z
        );
      }
    });

    // Side edges from side faces (perimeter only)
    result.sideFaces.forEach(sideFace => {
      // Each side face has 4 vertices: v0, v1 (bottom), v2, v3 (top)
      // The vertical edges are v0-v3 and v1-v2
      const verts = sideFace.vertices;
      wireframePositions.push(
        verts[0].x, verts[0].y, verts[0].z,
        verts[3].x, verts[3].y, verts[3].z
      );
    });

    const wireframeGeometry = new THREE.BufferGeometry();
    wireframeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wireframePositions, 3));

    const wireframe = new THREE.LineSegments(wireframeGeometry, this.wireframeMaterial);
    wireframe.renderOrder = 2;  // Render on top
    this.sceneManager.add(wireframe);
    this.previewWireframes.push(wireframe);
  }

  removePreview() {
    this.previewMeshes.forEach(mesh => {
      this.sceneManager.remove(mesh);
      mesh.geometry.dispose();
    });
    this.previewMeshes = [];

    this.previewWireframes.forEach(wireframe => {
      this.sceneManager.remove(wireframe);
      wireframe.geometry.dispose();
    });
    this.previewWireframes = [];
  }

  dispose() {
    this.deactivate();
    this.sideMaterial.dispose();
    this.frontMaterial.dispose();
    this.wireframeMaterial.dispose();
    this.gizmoMaterial.dispose();
  }
}
