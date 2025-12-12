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
 * Supports multi-selection
 */
export class ExtrudeTool {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.editableMesh = null;
    this.selectedFaces = [];  // Array for multi-selection

    this.isExtruding = false;
    this.startY = 0;
    this.startDistance = 0;
    this.currentDistance = 0;

    // Preview meshes for extrusion
    this.previewMeshes = [];
    this.previewWireframes = [];

    // Material for side faces (semi-transparent)
    this.sideMaterial = new THREE.MeshBasicMaterial({
      color: 0xB68133,  // Match selection color
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide
    });

    // Material for front face (more opaque to show where new face will be)
    this.frontMaterial = new THREE.MeshBasicMaterial({
      color: 0xB68133,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });

    // Wireframe material for preview edges
    this.wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0xFF9900,  // SelectionBorder color
      linewidth: 2
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

    this.isExtruding = true;
    this.startY = e.clientY;
    this.startDistance = 0;
    this.currentDistance = 0;

    // Disable orbit controls during drag
    this.sceneManager.setControlsEnabled(false);
  }

  handlePointerMove(e) {
    if (!this.isExtruding || this.selectedFaces.length === 0) return;

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
        faces: [...this.selectedFaces],
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
      this.onExtrudeComplete(this.pendingExtrusion.faces, this.pendingExtrusion.distance);
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
    if (this.selectedFaces.length === 0) return;

    // Remove old previews
    this.removePreview();

    if (Math.abs(this.currentDistance) < 0.001) return;

    // Create preview geometry for each selected face
    this.selectedFaces.forEach(face => {
      const result = extrudeFace(face, this.currentDistance, 0);

      // Build front face mesh (more opaque)
      const frontPositions = [];
      const frontIndices = [];

      result.extrudedFace.vertices.forEach(v => {
        frontPositions.push(v.x, v.y, v.z);
      });
      for (let i = 1; i < result.extrudedFace.vertices.length - 1; i++) {
        frontIndices.push(0, i, i + 1);
      }

      const frontGeometry = new THREE.BufferGeometry();
      frontGeometry.setAttribute('position', new THREE.Float32BufferAttribute(frontPositions, 3));
      frontGeometry.setIndex(frontIndices);
      frontGeometry.computeVertexNormals();

      const frontMesh = new THREE.Mesh(frontGeometry, this.frontMaterial);
      this.sceneManager.add(frontMesh);
      this.previewMeshes.push(frontMesh);

      // Build side faces mesh (semi-transparent)
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

      // Build wireframe for all edges
      const wireframePositions = [];

      // Front face edges
      const frontVerts = result.extrudedFace.vertices;
      for (let i = 0; i < frontVerts.length; i++) {
        const next = (i + 1) % frontVerts.length;
        wireframePositions.push(
          frontVerts[i].x, frontVerts[i].y, frontVerts[i].z,
          frontVerts[next].x, frontVerts[next].y, frontVerts[next].z
        );
      }

      // Side edges (connecting original to extruded)
      const origVerts = face.vertices;
      for (let i = 0; i < origVerts.length; i++) {
        wireframePositions.push(
          origVerts[i].x, origVerts[i].y, origVerts[i].z,
          frontVerts[i].x, frontVerts[i].y, frontVerts[i].z
        );
      }

      const wireframeGeometry = new THREE.BufferGeometry();
      wireframeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wireframePositions, 3));

      const wireframe = new THREE.LineSegments(wireframeGeometry, this.wireframeMaterial);
      wireframe.renderOrder = 2;  // Render on top
      this.sceneManager.add(wireframe);
      this.previewWireframes.push(wireframe);
    });
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
  }
}
