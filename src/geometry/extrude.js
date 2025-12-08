import * as THREE from 'three';
import { Face } from './face.js';

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
 * Extrusion tool handler
 * Manages the drag interaction for extruding faces
 */
export class ExtrudeTool {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.editableMesh = null;
    this.selectedFace = null;

    this.isExtruding = false;
    this.startY = 0;
    this.startDistance = 0;
    this.currentDistance = 0;

    // Preview mesh for extrusion
    this.previewMesh = null;
    this.previewMaterial = new THREE.MeshBasicMaterial({
      color: 0x4a90d9,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide
    });

    // Callbacks
    this.onExtrudeComplete = null;
    this.onReady = null;  // Called when extrusion is ready for approval

    // Pending extrusion data
    this.pendingExtrusion = null;

    // Sensitivity
    this.sensitivity = 0.01;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
  }

  setMesh(editableMesh) {
    this.editableMesh = editableMesh;
  }

  setSelectedFace(face) {
    this.selectedFace = face;
    this.updatePreview();
  }

  activate(canvas) {
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointerleave', this.handlePointerUp);
  }

  deactivate() {
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
      this.canvas.removeEventListener('pointermove', this.handlePointerMove);
      this.canvas.removeEventListener('pointerup', this.handlePointerUp);
      this.canvas.removeEventListener('pointerleave', this.handlePointerUp);
    }
    this.removePreview();
  }

  handlePointerDown(e) {
    if (!this.selectedFace) {
      // Allow 3D rotation when no face is selected
      this.sceneManager.setControlsEnabled(true);
      return;
    }

    // Check if clicking on the mesh
    const ndc = this.sceneManager.screenToNDC(e.clientX, e.clientY);
    const raycaster = this.sceneManager.getRaycaster(ndc.x, ndc.y);
    const intersects = raycaster.intersectObject(this.editableMesh.mesh);

    if (intersects.length === 0) {
      // Clicking on empty space - allow 3D rotation
      this.sceneManager.setControlsEnabled(true);
      return;
    }

    this.isExtruding = true;
    this.startY = e.clientY;
    this.startDistance = 0;
    this.currentDistance = 0;

    // Disable orbit controls during drag
    this.sceneManager.setControlsEnabled(false);
  }

  handlePointerMove(e) {
    if (!this.isExtruding || !this.selectedFace) return;

    const deltaY = this.startY - e.clientY;
    this.currentDistance = deltaY * this.sensitivity;

    this.updatePreview();
  }

  handlePointerUp(e) {
    if (!this.isExtruding) return;

    this.isExtruding = false;

    // Re-enable orbit controls
    this.sceneManager.setControlsEnabled(true);

    // If we moved enough, store pending and signal ready for approval
    if (Math.abs(this.currentDistance) > 0.01) {
      this.pendingExtrusion = {
        face: this.selectedFace,
        distance: this.currentDistance
      };
      // Keep the preview visible while waiting for approval
      if (this.onReady) {
        this.onReady(this.pendingExtrusion);
      }
    } else {
      this.currentDistance = 0;
      this.removePreview();
    }
  }

  /**
   * Execute the pending extrusion
   */
  executePendingExtrusion() {
    if (this.pendingExtrusion && this.onExtrudeComplete) {
      this.onExtrudeComplete(this.pendingExtrusion.face, this.pendingExtrusion.distance);
    }
    this.pendingExtrusion = null;
    this.currentDistance = 0;
    this.removePreview();
  }

  /**
   * Cancel the pending extrusion
   */
  cancelPendingExtrusion() {
    this.pendingExtrusion = null;
    this.currentDistance = 0;
    this.removePreview();
  }

  updatePreview() {
    if (!this.selectedFace) return;

    // Remove old preview
    this.removePreview();

    if (Math.abs(this.currentDistance) < 0.001) return;

    // Create preview geometry
    const result = extrudeFace(this.selectedFace, this.currentDistance, 0);

    // Build preview mesh from extruded face and side faces
    const positions = [];
    const indices = [];

    const addFace = (face, indexOffset) => {
      const startIdx = positions.length / 3;

      face.vertices.forEach(v => {
        positions.push(v.x, v.y, v.z);
      });

      // Triangulate
      for (let i = 1; i < face.vertices.length - 1; i++) {
        indices.push(startIdx, startIdx + i, startIdx + i + 1);
      }
    };

    addFace(result.extrudedFace);
    result.sideFaces.forEach(f => addFace(f));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    this.previewMesh = new THREE.Mesh(geometry, this.previewMaterial);
    this.sceneManager.add(this.previewMesh);
  }

  removePreview() {
    if (this.previewMesh) {
      this.sceneManager.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
      this.previewMesh = null;
    }
  }

  dispose() {
    this.deactivate();
    this.previewMaterial.dispose();
  }
}
