import * as THREE from 'three';
import { Face } from './face.js';
import { handleFaceSelection } from '../tools/selection.js';

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
 * Inset a face with relative offset - uniform distance from each edge
 * regardless of face aspect ratio (like Blender's "Offset Relative")
 *
 * @param {Face} face - Face to inset
 * @param {number} distance - Inset distance (absolute, same for all edges)
 * @param {number} nextFaceId - Starting ID for new faces
 * @returns {{insetFace: Face, sideFaces: Face[], nextFaceId: number}}
 */
export function insetFace(face, distance, nextFaceId) {
  const n = face.vertices.length;
  const normal = face.normal;

  // Calculate edge vectors and inward-facing normals for each edge
  const edgeNormals = [];
  for (let i = 0; i < n; i++) {
    const nextI = (i + 1) % n;
    const edge = new THREE.Vector3().subVectors(face.vertices[nextI], face.vertices[i]);

    // Inward normal is cross product of face normal and edge direction
    const inwardNormal = new THREE.Vector3().crossVectors(normal, edge).normalize();
    edgeNormals.push(inwardNormal);
  }

  // Calculate inset vertices using bisector method for uniform edge distance
  const insetVertices = face.vertices.map((v, i) => {
    const prevI = (i - 1 + n) % n;

    // Get the two edge normals adjacent to this vertex
    const normal1 = edgeNormals[prevI];  // Edge ending at this vertex
    const normal2 = edgeNormals[i];       // Edge starting at this vertex

    // Bisector direction (sum of the two inward normals)
    const bisector = new THREE.Vector3().addVectors(normal1, normal2);
    const bisectorLength = bisector.length();

    if (bisectorLength < 0.001) {
      // Edges are nearly parallel, just use one normal
      return v.clone().add(normal1.clone().multiplyScalar(distance));
    }

    // Scale factor for uniform perpendicular distance:
    // |n1 + n2| = 2 * cos(angle/2), so to get distance d from each edge,
    // we need to move by d / cos(angle/2) = d * 2 / |n1 + n2|
    const scale = distance * 2 / bisectorLength;

    bisector.normalize();
    return v.clone().add(bisector.multiplyScalar(scale));
  });

  // Calculate UV center for UV interpolation
  const uvCenter = new THREE.Vector2();
  face.uvs.forEach(uv => uvCenter.add(uv));
  uvCenter.divideScalar(n);

  // Calculate average edge length for UV scaling
  let totalEdgeLength = 0;
  for (let i = 0; i < n; i++) {
    const nextI = (i + 1) % n;
    totalEdgeLength += face.vertices[i].distanceTo(face.vertices[nextI]);
  }
  const avgEdgeLength = totalEdgeLength / n;

  // UV inset ratio based on distance relative to average edge length
  const uvInsetRatio = Math.min(0.99, distance / (avgEdgeLength * 0.5));

  // Create inset UVs
  const insetUVs = face.uvs.map(uv => {
    const direction = new THREE.Vector2().subVectors(uvCenter, uv);
    return uv.clone().add(direction.multiplyScalar(uvInsetRatio));
  });

  // Create the inset face (center face)
  const insetFaceResult = new Face(nextFaceId++, insetVertices, insetUVs);

  // Create side faces connecting outer edges to inner edges
  const sideFaces = [];

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
    insetFace: insetFaceResult,
    sideFaces,
    nextFaceId
  };
}

/**
 * Inset multiple faces together as a region (like Blender's default inset)
 * Only creates side faces along the outer perimeter - shared edges don't get side faces
 *
 * @param {Face[]} faces - Faces to inset
 * @param {number} distance - Inset distance (absolute, same for all edges)
 * @param {number} nextFaceId - Starting ID for new faces
 * @returns {{insetFaces: Face[], sideFaces: Face[], nextFaceId: number}}
 */
export function insetFaces(faces, distance, nextFaceId) {
  if (faces.length === 0) {
    return { insetFaces: [], sideFaces: [], nextFaceId };
  }

  // Count edge occurrences across all faces to find perimeter edges
  const edgeCounts = new Map();

  faces.forEach(face => {
    const n = face.vertices.length;
    for (let i = 0; i < n; i++) {
      const nextI = (i + 1) % n;
      const key = edgeKey(face.vertices[i], face.vertices[nextI]);
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  });

  // Process each face and compute inset vertices
  const insetFacesResult = [];
  const allSideFaces = [];

  faces.forEach(face => {
    const n = face.vertices.length;
    const normal = face.normal;

    // Calculate edge vectors and inward-facing normals for each edge
    const edgeNormals = [];
    for (let i = 0; i < n; i++) {
      const nextI = (i + 1) % n;
      const edge = new THREE.Vector3().subVectors(face.vertices[nextI], face.vertices[i]);
      const inwardNormal = new THREE.Vector3().crossVectors(normal, edge).normalize();
      edgeNormals.push(inwardNormal);
    }

    // Calculate inset vertices using bisector method
    // Each face gets its own inset vertices (don't share across faces - they have different normals)
    const insetVertices = face.vertices.map((v, i) => {
      const prevI = (i - 1 + n) % n;
      const normal1 = edgeNormals[prevI];
      const normal2 = edgeNormals[i];

      const bisector = new THREE.Vector3().addVectors(normal1, normal2);
      const bisectorLength = bisector.length();

      if (bisectorLength < 0.001) {
        return v.clone().add(normal1.clone().multiplyScalar(distance));
      } else {
        const scale = distance * 2 / bisectorLength;
        bisector.normalize();
        return v.clone().add(bisector.multiplyScalar(scale));
      }
    });

    // Calculate UV center and inset UVs
    const uvCenter = new THREE.Vector2();
    face.uvs.forEach(uv => uvCenter.add(uv));
    uvCenter.divideScalar(n);

    let totalEdgeLength = 0;
    for (let i = 0; i < n; i++) {
      const nextI = (i + 1) % n;
      totalEdgeLength += face.vertices[i].distanceTo(face.vertices[nextI]);
    }
    const avgEdgeLength = totalEdgeLength / n;
    const uvInsetRatio = Math.min(0.99, distance / (avgEdgeLength * 0.5));

    const insetUVs = face.uvs.map(uv => {
      const direction = new THREE.Vector2().subVectors(uvCenter, uv);
      return uv.clone().add(direction.multiplyScalar(uvInsetRatio));
    });

    // Create the inset face
    const insetFaceResult = new Face(nextFaceId++, insetVertices, insetUVs);
    insetFacesResult.push(insetFaceResult);

    // Create side faces only for perimeter edges (edges that appear once)
    for (let i = 0; i < n; i++) {
      const nextI = (i + 1) % n;
      const key = edgeKey(face.vertices[i], face.vertices[nextI]);

      // Only create side face if edge is on the perimeter (appears once)
      if (edgeCounts.get(key) === 1) {
        const v0 = face.vertices[i].clone();
        const v1 = face.vertices[nextI].clone();
        const v2 = insetVertices[nextI].clone();
        const v3 = insetVertices[i].clone();

        const uv0 = face.uvs[i].clone();
        const uv1 = face.uvs[nextI].clone();
        const uv2 = insetUVs[nextI].clone();
        const uv3 = insetUVs[i].clone();

        const sideFace = new Face(nextFaceId++, [v0, v1, v2, v3], [uv0, uv1, uv2, uv3]);
        allSideFaces.push(sideFace);
      }
    }
  });

  return {
    insetFaces: insetFacesResult,
    sideFaces: allSideFaces,
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

    // Individual mode: when true, each face is inset independently
    // when false (default), faces are inset as a region together
    this.individualMode = false;

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
    this.onModeToggle = null;    // Called when individual mode is toggled

    // Max inset distance (calculated dynamically based on face size)
    this.maxInsetDistance = 0;

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

  /**
   * Toggle between individual and region inset modes
   * @returns {boolean} The new mode state (true = individual)
   */
  toggleIndividualMode() {
    this.individualMode = !this.individualMode;
    if (this.onModeToggle) {
      this.onModeToggle(this.individualMode);
    }
    return this.individualMode;
  }

  /**
   * Set individual mode directly
   * @param {boolean} individual - Whether to use individual mode
   */
  setIndividualMode(individual) {
    if (this.individualMode !== individual) {
      this.individualMode = individual;
      if (this.onModeToggle) {
        this.onModeToggle(this.individualMode);
      }
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

    // Handle selection (supports shift-click for multi-select)
    handleFaceSelection(e, face, this.selectedFaces, this.selectTool, this.onFaceSelected);

    // Update gizmo
    this.createGizmo();

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

      // Calculate max safe inset distance based on shortest edge across all selected faces
      this.maxInsetDistance = this.calculateMaxInsetDistance();
    }

    if (this.isDragging) {
      // Drag right = more inset, scaled by face size
      const dragDelta = e.clientX - this.startX;
      // Max inset at ~200px drag, minimum at very small drag
      const maxDragPixels = 200;
      const normalizedDrag = Math.max(0, dragDelta / maxDragPixels);
      // Use 90% of max safe distance to avoid edge cases
      this.currentThickness = Math.min(normalizedDrag, 0.95) * this.maxInsetDistance * 0.9;
      this.updatePreview();
    }
  }

  /**
   * Calculate maximum safe inset distance based on face geometry
   * Returns roughly half of the shortest edge (safe inset limit)
   */
  calculateMaxInsetDistance() {
    let minEdgeLength = Infinity;

    this.selectedFaces.forEach(face => {
      const n = face.vertices.length;
      for (let i = 0; i < n; i++) {
        const nextI = (i + 1) % n;
        const edgeLength = face.vertices[i].distanceTo(face.vertices[nextI]);
        if (edgeLength < minEdgeLength) {
          minEdgeLength = edgeLength;
        }
      }
    });

    // Safe max is about half the shortest edge
    return minEdgeLength * 0.5;
  }

  handlePointerUp(e) {
    if (!this.isInsetting) return;

    this.isInsetting = false;
    this.sceneManager.setControlsEnabled(true);

    // Check if meaningful inset occurred (at least 5% of max)
    const minThreshold = (this.maxInsetDistance || 0.1) * 0.05;
    if (this.isDragging && this.currentThickness > minThreshold) {
      // Execute inset immediately on release
      if (this.onInsetComplete) {
        this.onInsetComplete([...this.selectedFaces], this.currentThickness, this.individualMode);
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

    // Calculate average normal for z-fighting offset
    const avgNormal = new THREE.Vector3();
    this.selectedFaces.forEach(face => avgNormal.add(face.normal));
    avgNormal.normalize();
    const normalOffset = avgNormal.clone().multiplyScalar(0.001);

    if (this.individualMode) {
      // Individual mode: inset each face separately
      this.selectedFaces.forEach(face => {
        const result = insetFace(face, this.currentThickness, 0);
        this.createPreviewForResult(result.insetFace, result.sideFaces, face, normalOffset);
      });
    } else {
      // Region mode: inset all faces together (shared edges don't get side faces)
      const result = insetFaces(this.selectedFaces, this.currentThickness, 0);

      // Create preview for each inset face
      result.insetFaces.forEach((insetFaceResult, idx) => {
        const originalFace = this.selectedFaces[idx];
        // For region mode, we pass null for sideFaces per-face since they're combined
        this.createPreviewForResult(insetFaceResult, [], originalFace, normalOffset);
      });

      // Create combined side faces preview (only perimeter edges)
      if (result.sideFaces.length > 0) {
        this.createSideFacesPreview(result.sideFaces, normalOffset);
      }

      // Create wireframe for region mode (show all inset face edges and perimeter connections)
      this.createRegionWireframe(result, normalOffset);
    }
  }

  /**
   * Create preview meshes for a single inset result
   */
  createPreviewForResult(insetFaceResult, sideFaces, originalFace, normalOffset) {
    // Build center inset face mesh (more opaque)
    const centerPositions = [];
    const centerIndices = [];

    insetFaceResult.vertices.forEach(v => {
      centerPositions.push(
        v.x + normalOffset.x,
        v.y + normalOffset.y,
        v.z + normalOffset.z
      );
    });
    for (let i = 1; i < insetFaceResult.vertices.length - 1; i++) {
      centerIndices.push(0, i, i + 1);
    }

    const centerGeometry = new THREE.BufferGeometry();
    centerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(centerPositions, 3));
    centerGeometry.setIndex(centerIndices);
    centerGeometry.computeVertexNormals();

    const centerMesh = new THREE.Mesh(centerGeometry, this.centerMaterial);
    this.sceneManager.add(centerMesh);
    this.previewMeshes.push(centerMesh);

    // Build side faces mesh if provided (individual mode)
    if (sideFaces.length > 0) {
      const sidePositions = [];
      const sideIndices = [];

      sideFaces.forEach(f => {
        const startIdx = sidePositions.length / 3;
        f.vertices.forEach(v => {
          sidePositions.push(
            v.x + normalOffset.x,
            v.y + normalOffset.y,
            v.z + normalOffset.z
          );
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

      // Build wireframe for individual mode
      const wireframePositions = [];

      // Inset face edges
      const insetVerts = insetFaceResult.vertices;
      for (let i = 0; i < insetVerts.length; i++) {
        const next = (i + 1) % insetVerts.length;
        wireframePositions.push(
          insetVerts[i].x + normalOffset.x,
          insetVerts[i].y + normalOffset.y,
          insetVerts[i].z + normalOffset.z,
          insetVerts[next].x + normalOffset.x,
          insetVerts[next].y + normalOffset.y,
          insetVerts[next].z + normalOffset.z
        );
      }

      // Side edges (connecting outer to inner)
      const outerVerts = originalFace.vertices;
      for (let i = 0; i < outerVerts.length; i++) {
        wireframePositions.push(
          outerVerts[i].x + normalOffset.x,
          outerVerts[i].y + normalOffset.y,
          outerVerts[i].z + normalOffset.z,
          insetVerts[i].x + normalOffset.x,
          insetVerts[i].y + normalOffset.y,
          insetVerts[i].z + normalOffset.z
        );
      }

      const wireframeGeometry = new THREE.BufferGeometry();
      wireframeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wireframePositions, 3));

      const wireframe = new THREE.LineSegments(wireframeGeometry, this.wireframeMaterial);
      wireframe.renderOrder = 2;
      this.sceneManager.add(wireframe);
      this.previewWireframes.push(wireframe);
    }
  }

  /**
   * Create side faces preview for region mode (combined perimeter edges)
   */
  createSideFacesPreview(sideFaces, normalOffset) {
    const sidePositions = [];
    const sideIndices = [];

    sideFaces.forEach(f => {
      const startIdx = sidePositions.length / 3;
      f.vertices.forEach(v => {
        sidePositions.push(
          v.x + normalOffset.x,
          v.y + normalOffset.y,
          v.z + normalOffset.z
        );
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

  /**
   * Create wireframe for region mode
   */
  createRegionWireframe(result, normalOffset) {
    const wireframePositions = [];

    // All inset face edges
    result.insetFaces.forEach(insetFaceResult => {
      const insetVerts = insetFaceResult.vertices;
      for (let i = 0; i < insetVerts.length; i++) {
        const next = (i + 1) % insetVerts.length;
        wireframePositions.push(
          insetVerts[i].x + normalOffset.x,
          insetVerts[i].y + normalOffset.y,
          insetVerts[i].z + normalOffset.z,
          insetVerts[next].x + normalOffset.x,
          insetVerts[next].y + normalOffset.y,
          insetVerts[next].z + normalOffset.z
        );
      }
    });

    // Perimeter side edges (from side faces)
    result.sideFaces.forEach(sideFace => {
      // Each side face connects outer edge to inner edge
      // Draw the connecting edges (v0->v3 and v1->v2)
      const v = sideFace.vertices;
      wireframePositions.push(
        v[0].x + normalOffset.x, v[0].y + normalOffset.y, v[0].z + normalOffset.z,
        v[3].x + normalOffset.x, v[3].y + normalOffset.y, v[3].z + normalOffset.z
      );
      wireframePositions.push(
        v[1].x + normalOffset.x, v[1].y + normalOffset.y, v[1].z + normalOffset.z,
        v[2].x + normalOffset.x, v[2].y + normalOffset.y, v[2].z + normalOffset.z
      );
    });

    const wireframeGeometry = new THREE.BufferGeometry();
    wireframeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wireframePositions, 3));

    const wireframe = new THREE.LineSegments(wireframeGeometry, this.wireframeMaterial);
    wireframe.renderOrder = 2;
    this.sceneManager.add(wireframe);
    this.previewWireframes.push(wireframe);
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
