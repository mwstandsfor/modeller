import * as THREE from 'three';
import { Face } from './face.js';

/**
 * Inset a face - creates a smaller face inside with connecting side faces
 *
 * @param {Face} face - Face to inset
 * @param {number} thickness - Inset amount (0-1, where 1 would collapse to center)
 * @param {number} nextFaceId - Starting ID for new faces
 * @returns {{insetFace: Face, sideFaces: Face[], nextFaceId: number}}
 */
export function insetFace(face, thickness, nextFaceId) {
  // Clamp thickness to valid range
  thickness = Math.max(0.01, Math.min(0.99, thickness));

  // Calculate the center of the face
  const center = new THREE.Vector3();
  face.vertices.forEach(v => center.add(v));
  center.divideScalar(face.vertices.length);

  // Calculate UV center
  const uvCenter = new THREE.Vector2();
  face.uvs.forEach(uv => uvCenter.add(uv));
  uvCenter.divideScalar(face.uvs.length);

  // Create inset vertices by moving each vertex toward the center
  const insetVertices = face.vertices.map(v => {
    const direction = new THREE.Vector3().subVectors(center, v);
    return v.clone().add(direction.multiplyScalar(thickness));
  });

  // Create inset UVs
  const insetUVs = face.uvs.map(uv => {
    const direction = new THREE.Vector2().subVectors(uvCenter, uv);
    return uv.clone().add(direction.multiplyScalar(thickness));
  });

  // Create the inset face (center face)
  const insetFace = new Face(nextFaceId++, insetVertices, insetUVs);

  // Create side faces connecting outer edges to inner edges
  const sideFaces = [];
  const n = face.vertices.length;

  for (let i = 0; i < n; i++) {
    const nextI = (i + 1) % n;

    // Four corners of the side quad:
    // - Two outer vertices (from original face)
    // - Two inner vertices (from inset face)
    const v0 = face.vertices[i].clone();
    const v1 = face.vertices[nextI].clone();
    const v2 = insetVertices[nextI].clone();
    const v3 = insetVertices[i].clone();

    // UV coordinates for side face
    const uv0 = face.uvs[i].clone();
    const uv1 = face.uvs[nextI].clone();
    const uv2 = insetUVs[nextI].clone();
    const uv3 = insetUVs[i].clone();

    const sideFace = new Face(nextFaceId++, [v0, v1, v2, v3], [uv0, uv1, uv2, uv3]);
    sideFaces.push(sideFace);
  }

  return {
    insetFace,
    sideFaces,
    nextFaceId
  };
}

/**
 * Inset tool handler
 * Manages the drag interaction for insetting faces
 * Supports multi-selection
 */
export class InsetTool {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.editableMesh = null;
    this.selectedFaces = [];  // Array for multi-selection

    this.isInsetting = false;
    this.startX = 0;
    this.currentThickness = 0;

    // Preview meshes for inset
    this.previewMeshes = [];
    this.previewMaterial = new THREE.MeshBasicMaterial({
      color: 0xB68133,  // Match selection color
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide
    });

    // Callbacks
    this.onInsetComplete = null;
    this.onReady = null;

    // Pending inset data
    this.pendingInset = null;

    // Sensitivity (pixels to thickness ratio)
    this.sensitivity = 0.003;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
  }

  setMesh(editableMesh) {
    this.editableMesh = editableMesh;
  }

  setSelectedFaces(faces) {
    this.selectedFaces = faces || [];
    this.updatePreview();
  }

  // Legacy support for single face
  setSelectedFace(face) {
    this.selectedFaces = face ? [face] : [];
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
    if (this.selectedFaces.length === 0) {
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

    this.isInsetting = true;
    this.startX = e.clientX;
    this.currentThickness = 0;

    // Disable orbit controls during drag
    this.sceneManager.setControlsEnabled(false);
  }

  handlePointerMove(e) {
    if (!this.isInsetting || this.selectedFaces.length === 0) return;

    // Drag right = more inset
    const deltaX = e.clientX - this.startX;
    this.currentThickness = Math.max(0.01, Math.min(0.8, deltaX * this.sensitivity));

    this.updatePreview();
  }

  handlePointerUp(e) {
    if (!this.isInsetting) return;

    this.isInsetting = false;

    // Re-enable orbit controls
    this.sceneManager.setControlsEnabled(true);

    // If we moved enough, store pending and signal ready for approval
    if (this.currentThickness > 0.02) {
      this.pendingInset = {
        faces: [...this.selectedFaces],
        thickness: this.currentThickness
      };
      // Keep the preview visible while waiting for approval
      if (this.onReady) {
        this.onReady(this.pendingInset);
      }
    } else {
      this.currentThickness = 0;
      this.removePreview();
    }
  }

  /**
   * Execute the pending inset
   */
  executePendingInset() {
    if (this.pendingInset && this.onInsetComplete) {
      this.onInsetComplete(this.pendingInset.faces, this.pendingInset.thickness);
    }
    this.pendingInset = null;
    this.currentThickness = 0;
    this.removePreview();
  }

  /**
   * Cancel the pending inset
   */
  cancelPendingInset() {
    this.pendingInset = null;
    this.currentThickness = 0;
    this.removePreview();
  }

  updatePreview() {
    if (this.selectedFaces.length === 0) return;

    // Remove old previews
    this.removePreview();

    if (this.currentThickness < 0.01) return;

    // Create preview geometry for each selected face
    this.selectedFaces.forEach(face => {
      const result = insetFace(face, this.currentThickness, 0);

      // Build preview mesh from inset face and side faces
      const positions = [];
      const indices = [];

      const addFace = (f) => {
        const startIdx = positions.length / 3;

        f.vertices.forEach(v => {
          positions.push(v.x, v.y, v.z);
        });

        // Triangulate
        for (let i = 1; i < f.vertices.length - 1; i++) {
          indices.push(startIdx, startIdx + i, startIdx + i + 1);
        }
      };

      addFace(result.insetFace);
      result.sideFaces.forEach(f => addFace(f));

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const previewMesh = new THREE.Mesh(geometry, this.previewMaterial);
      this.sceneManager.add(previewMesh);
      this.previewMeshes.push(previewMesh);
    });
  }

  removePreview() {
    this.previewMeshes.forEach(mesh => {
      this.sceneManager.remove(mesh);
      mesh.geometry.dispose();
    });
    this.previewMeshes = [];
  }

  dispose() {
    this.deactivate();
    this.previewMaterial.dispose();
  }
}
