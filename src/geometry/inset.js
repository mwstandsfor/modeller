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
 * Tap+drag workflow: tap selects face with gizmo, drag insets, release confirms
 * Supports multi-selection via SelectTool
 */
export class InsetTool {
  constructor(sceneManager, selectTool = null) {
    this.sceneManager = sceneManager;
    this.selectTool = selectTool;
    this.editableMesh = null;
    this.selectedFaces = [];  // Array for multi-selection

    this.isInsetting = false;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.currentThickness = 0;
    this.dragThreshold = 5;  // pixels before drag starts

    // Preview meshes for inset
    this.previewMeshes = [];
    this.previewWireframes = [];
    this.isPreviewVisible = false;  // Track if preview is showing

    // Normal gizmo
    this.gizmo = null;
    this.gizmoLength = 32;  // pixels

    // Material for side faces (semi-transparent)
    this.sideMaterial = new THREE.MeshBasicMaterial({
      color: 0xB68133,  // Match selection color
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide
    });

    // Material for center inset face (more opaque to show where new face will be)
    this.centerMaterial = new THREE.MeshBasicMaterial({
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

    // Gizmo material
    this.gizmoMaterial = new THREE.LineBasicMaterial({
      color: 0xFF9900,
      linewidth: 3,
      depthTest: false
    });

    // Callbacks
    this.onInsetComplete = null;
    this.onFaceSelected = null;  // Called when face is tapped

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
    return this.editableMesh.findFaceAtPoint(point);
  }

  handlePointerDown(e) {
    if (!this.editableMesh) return;

    this.startX = e.clientX;
    this.startY = e.clientY;
    this.isDragging = false;
    this.isInsetting = false;
    this.currentThickness = 0;

    // Find face under cursor
    const face = this.findFaceAtPoint(e.clientX, e.clientY);

    if (!face) {
      // Clicking on empty space - allow 3D rotation
      this.sceneManager.setControlsEnabled(true);
      return;
    }

    // Disable orbit controls
    this.sceneManager.setControlsEnabled(false);

    // Check if clicking on already selected face
    const isAlreadySelected = this.selectedFaces.some(f => f.id === face.id);

    if (!isAlreadySelected) {
      // Select the new face (single selection in inset mode)
      this.selectedFaces = [face];

      // Update selection highlight via selectTool
      if (this.selectTool) {
        this.selectTool.clearSelection();
        this.selectTool.selectFace(face);
      }

      // Notify main app
      if (this.onFaceSelected) {
        this.onFaceSelected([face]);
      }

      // Show gizmo
      this.createGizmo();
    }

    // Prepare for potential drag
    this.isInsetting = true;
  }

  handlePointerMove(e) {
    if (!this.isInsetting || this.selectedFaces.length === 0) return;

    const deltaX = Math.abs(e.clientX - this.startX);
    const deltaY = Math.abs(e.clientY - this.startY);

    // Check if drag threshold exceeded
    if (!this.isDragging && (deltaX > this.dragThreshold || deltaY > this.dragThreshold)) {
      this.isDragging = true;
      // Hide selection highlight immediately to prevent z-fighting with preview
      if (this.selectTool) {
        this.selectTool.hideHighlight();
      }
      // Hide gizmo during drag
      this.removeGizmo();
    }

    if (this.isDragging) {
      // Drag right = more inset
      const dragDelta = e.clientX - this.startX;
      this.currentThickness = Math.max(0.01, Math.min(0.8, dragDelta * this.sensitivity));
      this.updatePreview();
    }
  }

  handlePointerUp(e) {
    if (!this.isInsetting) return;

    this.isInsetting = false;
    this.sceneManager.setControlsEnabled(true);

    if (this.isDragging && this.currentThickness > 0.02) {
      // Execute inset immediately on release
      if (this.onInsetComplete) {
        this.onInsetComplete([...this.selectedFaces], this.currentThickness);
      }
      this.removePreview();
      // Gizmo will be recreated when selection is updated after inset
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
    this.currentThickness = 0;
  }

  updatePreview() {
    if (this.selectedFaces.length === 0) return;

    // Remove old previews (but don't show selection highlight yet)
    this.removePreviewMeshes();

    if (this.currentThickness < 0.01) {
      // No preview to show, restore selection highlight
      if (this.isPreviewVisible && this.selectTool) {
        this.selectTool.showHighlight();
        this.isPreviewVisible = false;
      }
      return;
    }

    // Hide selection highlight when showing preview (avoid z-fighting)
    if (!this.isPreviewVisible && this.selectTool) {
      this.selectTool.hideHighlight();
      this.isPreviewVisible = true;
    }

    // Create preview geometry for each selected face
    this.selectedFaces.forEach(face => {
      const result = insetFace(face, this.currentThickness, 0);

      // Build center inset face mesh (more opaque)
      const centerPositions = [];
      const centerIndices = [];

      result.insetFace.vertices.forEach(v => {
        centerPositions.push(v.x, v.y, v.z);
      });
      for (let i = 1; i < result.insetFace.vertices.length - 1; i++) {
        centerIndices.push(0, i, i + 1);
      }

      const centerGeometry = new THREE.BufferGeometry();
      centerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(centerPositions, 3));
      centerGeometry.setIndex(centerIndices);
      centerGeometry.computeVertexNormals();

      const centerMesh = new THREE.Mesh(centerGeometry, this.centerMaterial);
      this.sceneManager.add(centerMesh);
      this.previewMeshes.push(centerMesh);

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

      // Center inset face edges
      const insetVerts = result.insetFace.vertices;
      for (let i = 0; i < insetVerts.length; i++) {
        const next = (i + 1) % insetVerts.length;
        wireframePositions.push(
          insetVerts[i].x, insetVerts[i].y, insetVerts[i].z,
          insetVerts[next].x, insetVerts[next].y, insetVerts[next].z
        );
      }

      // Side edges (connecting outer to inner)
      const outerVerts = face.vertices;
      for (let i = 0; i < outerVerts.length; i++) {
        wireframePositions.push(
          outerVerts[i].x, outerVerts[i].y, outerVerts[i].z,
          insetVerts[i].x, insetVerts[i].y, insetVerts[i].z
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

  /**
   * Remove preview meshes only (doesn't restore selection highlight)
   */
  removePreviewMeshes() {
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

  /**
   * Remove preview and restore selection highlight
   */
  removePreview() {
    this.removePreviewMeshes();

    // Restore selection highlight
    if (this.isPreviewVisible && this.selectTool) {
      this.selectTool.showHighlight();
      this.isPreviewVisible = false;
    }
  }

  dispose() {
    this.deactivate();
    this.sideMaterial.dispose();
    this.centerMaterial.dispose();
    this.wireframeMaterial.dispose();
    this.gizmoMaterial.dispose();
  }
}
