import * as THREE from 'three';

/**
 * Face selection tool
 * Tap on faces to toggle selection (multi-select by default)
 * Drag to orbit (doesn't affect selection)
 * Double-tap on empty space to clear selection
 */
export class SelectTool {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.editableMesh = null;
    this.selectedFaces = [];  // Array for multi-selection

    // Tap detection
    this.pointerStartX = 0;
    this.pointerStartY = 0;
    this.pointerStartTime = 0;
    this.tapThreshold = 10;      // Max pixels movement for tap
    this.tapMaxDuration = 300;   // Max ms for tap
    this.isPointerDown = false;

    // Double-tap detection for clearing selection
    this.lastEmptyTapTime = 0;
    this.doubleTapDelay = 300;   // Max ms between taps for double-tap

    // Visual feedback - using design colors
    this.highlightMeshes = [];
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xB68133,  // Face Selection overlay
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthTest: false
    });

    this.outlineMaterial = new THREE.LineBasicMaterial({
      color: 0xFF9900,  // SelectionBorder
      linewidth: 2
    });

    this.outlineMeshes = [];

    // Hover highlight
    this.hoverMesh = null;
    this.hoverMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthTest: false
    });

    // Callbacks
    this.onSelect = null;

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
  }

  setMesh(editableMesh) {
    this.editableMesh = editableMesh;
  }

  activate(canvas) {
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointermove', this.handlePointerMove);

    // Enable controls for wheel zoom and rotation
    this.sceneManager.setControlsEnabled(true);
  }

  deactivate() {
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
      this.canvas.removeEventListener('pointerup', this.handlePointerUp);
      this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    }
    this.clearHighlight();
    this.clearHover();
    this.isPointerDown = false;
  }

  handlePointerDown(e) {
    // Only track primary pointer (ignore multi-touch for selection)
    if (!e.isPrimary) return;

    this.pointerStartX = e.clientX;
    this.pointerStartY = e.clientY;
    this.pointerStartTime = Date.now();
    this.isPointerDown = true;

    // Keep orbit controls enabled - they will handle dragging
  }

  handlePointerUp(e) {
    if (!e.isPrimary || !this.isPointerDown) return;
    this.isPointerDown = false;

    if (!this.editableMesh) return;

    // Check if this was a tap (short duration, small movement)
    const deltaX = Math.abs(e.clientX - this.pointerStartX);
    const deltaY = Math.abs(e.clientY - this.pointerStartY);
    const duration = Date.now() - this.pointerStartTime;

    const isTap = deltaX < this.tapThreshold &&
                  deltaY < this.tapThreshold &&
                  duration < this.tapMaxDuration;

    if (!isTap) {
      // Was a drag - orbit controls handled it, do nothing for selection
      return;
    }

    // It was a tap - check what was tapped
    const face = this.raycastFace(e.clientX, e.clientY);

    if (face) {
      // Tapped on a face - toggle its selection
      this.toggleFaceSelection(face);
      // Reset empty tap tracking when tapping on a face
      this.lastEmptyTapTime = 0;
    } else {
      // Tapped on empty space - check for double-tap to clear selection
      const now = Date.now();
      if (now - this.lastEmptyTapTime < this.doubleTapDelay) {
        // Double-tap on empty space - clear selection
        this.clearSelection();
        this.lastEmptyTapTime = 0;
      } else {
        // First tap on empty space - record time
        this.lastEmptyTapTime = now;
      }
    }
  }

  handlePointerMove(e) {
    if (!this.editableMesh) return;

    // Only update hover when not dragging
    if (!this.isPointerDown) {
      const face = this.raycastFace(e.clientX, e.clientY);
      this.updateHover(face);
    }
  }

  /**
   * Raycast to find which face was clicked
   */
  raycastFace(screenX, screenY) {
    if (!this.editableMesh || !this.editableMesh.mesh) return null;

    const ndc = this.sceneManager.screenToNDC(screenX, screenY);
    const raycaster = this.sceneManager.getRaycaster(ndc.x, ndc.y);

    const intersects = raycaster.intersectObject(this.editableMesh.mesh);

    if (intersects.length === 0) return null;

    const hitPoint = intersects[0].point;
    const triangleIndex = intersects[0].faceIndex;

    // Use triangle index for direct lookup (most accurate)
    return this.editableMesh.findFaceAtPoint(hitPoint, triangleIndex);
  }

  /**
   * Select a single face (clear previous selection)
   */
  selectFace(face) {
    // Clear previous selection
    this.selectedFaces = [];

    if (face) {
      this.selectedFaces = [face];
    }

    // Update mesh selection state
    this.editableMesh.faces.forEach(f => f.selected = false);
    if (face) {
      face.selected = true;
    }

    // Update visual
    this.updateHighlight();

    // Callback
    if (this.onSelect) {
      this.onSelect(this.selectedFaces);
    }
  }

  /**
   * Toggle face in multi-selection
   */
  toggleFaceSelection(face) {
    const index = this.selectedFaces.findIndex(f => f.id === face.id);

    if (index >= 0) {
      // Remove from selection
      this.selectedFaces.splice(index, 1);
      face.selected = false;
    } else {
      // Add to selection
      this.selectedFaces.push(face);
      face.selected = true;
    }

    // Update visual
    this.updateHighlight();

    // Callback
    if (this.onSelect) {
      this.onSelect(this.selectedFaces);
    }
  }

  /**
   * Check if a face is selected
   */
  isFaceSelected(face) {
    return this.selectedFaces.some(f => f.id === face.id);
  }

  /**
   * Get selected faces
   */
  getSelectedFaces() {
    return this.selectedFaces;
  }

  clearSelection() {
    if (this.editableMesh) {
      this.editableMesh.faces.forEach(f => f.selected = false);
    }
    this.selectedFaces = [];
    this.clearHighlight();

    if (this.onSelect) {
      this.onSelect([]);
    }
  }

  updateHighlight() {
    this.clearHighlight();

    if (this.selectedFaces.length === 0) return;

    // Create highlight for each selected face
    this.selectedFaces.forEach(face => {
      // Create highlight mesh
      const positions = [];
      face.vertices.forEach(v => {
        positions.push(v.x, v.y, v.z);
      });

      const indices = [];
      for (let i = 1; i < face.vertices.length - 1; i++) {
        indices.push(0, i, i + 1);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);

      const highlightMesh = new THREE.Mesh(geometry, this.highlightMaterial);
      highlightMesh.renderOrder = 999;
      this.sceneManager.add(highlightMesh);
      this.highlightMeshes.push(highlightMesh);

      // Create outline
      const outlinePositions = [];
      face.vertices.forEach(v => {
        outlinePositions.push(v.x, v.y, v.z);
      });
      // Close the loop
      outlinePositions.push(face.vertices[0].x, face.vertices[0].y, face.vertices[0].z);

      const outlineGeometry = new THREE.BufferGeometry();
      outlineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));

      const outlineMesh = new THREE.Line(outlineGeometry, this.outlineMaterial);
      outlineMesh.renderOrder = 1000;
      this.sceneManager.add(outlineMesh);
      this.outlineMeshes.push(outlineMesh);
    });
  }

  clearHighlight() {
    this.highlightMeshes.forEach(mesh => {
      this.sceneManager.remove(mesh);
      mesh.geometry.dispose();
    });
    this.highlightMeshes = [];

    this.outlineMeshes.forEach(mesh => {
      this.sceneManager.remove(mesh);
      mesh.geometry.dispose();
    });
    this.outlineMeshes = [];
  }

  /**
   * Temporarily hide selection highlights (without clearing selection)
   */
  hideHighlight() {
    this.highlightMeshes.forEach(mesh => {
      mesh.visible = false;
    });
    this.outlineMeshes.forEach(mesh => {
      mesh.visible = false;
    });
  }

  /**
   * Show selection highlights again
   */
  showHighlight() {
    this.highlightMeshes.forEach(mesh => {
      mesh.visible = true;
    });
    this.outlineMeshes.forEach(mesh => {
      mesh.visible = true;
    });
  }

  updateHover(face) {
    this.clearHover();

    // Don't hover on selected faces
    if (!face || this.isFaceSelected(face)) return;

    const positions = [];
    face.vertices.forEach(v => {
      positions.push(v.x, v.y, v.z);
    });

    const indices = [];
    for (let i = 1; i < face.vertices.length - 1; i++) {
      indices.push(0, i, i + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);

    this.hoverMesh = new THREE.Mesh(geometry, this.hoverMaterial);
    this.hoverMesh.renderOrder = 998;
    this.sceneManager.add(this.hoverMesh);
  }

  clearHover() {
    if (this.hoverMesh) {
      this.sceneManager.remove(this.hoverMesh);
      this.hoverMesh.geometry.dispose();
      this.hoverMesh = null;
    }
  }

  dispose() {
    this.deactivate();
    this.highlightMaterial.dispose();
    this.hoverMaterial.dispose();
    this.outlineMaterial.dispose();
  }
}
