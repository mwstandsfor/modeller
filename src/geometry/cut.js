import * as THREE from 'three';


/**
 * Cut tool - splits faces with edge-to-edge lines
 */

/**
 * Find the closest point on a line segment to a given point
 * @param {THREE.Vector3} point
 * @param {THREE.Vector3} lineStart
 * @param {THREE.Vector3} lineEnd
 * @returns {{point: THREE.Vector3, t: number, distance: number}}
 */
export function closestPointOnSegment(point, lineStart, lineEnd) {
  const line = new THREE.Vector3().subVectors(lineEnd, lineStart);
  const len = line.length();

  if (len < 0.0001) {
    return {
      point: lineStart.clone(),
      t: 0,
      distance: point.distanceTo(lineStart)
    };
  }

  line.normalize();

  const toPoint = new THREE.Vector3().subVectors(point, lineStart);
  let t = toPoint.dot(line);

  // Clamp to segment
  t = Math.max(0, Math.min(len, t));

  const closest = new THREE.Vector3()
    .copy(lineStart)
    .add(line.multiplyScalar(t));

  return {
    point: closest,
    t: t / len, // Normalized 0-1
    distance: point.distanceTo(closest)
  };
}

/**
 * Find the closest edge to a 3D point
 * @param {THREE.Vector3} point - Point in world space
 * @param {Face} face - Face to check edges on
 * @param {number} threshold - Maximum distance to consider
 * @returns {{edge: object, point: THREE.Vector3, t: number}|null}
 */
export function findClosestEdge(point, face, threshold = 0.1) {
  const edges = face.getEdges();
  let closest = null;
  let minDistance = threshold;

  for (const edge of edges) {
    const result = closestPointOnSegment(point, edge.start, edge.end);

    if (result.distance < minDistance) {
      minDistance = result.distance;
      closest = {
        edge,
        point: result.point,
        t: result.t
      };
    }
  }

  return closest;
}

/**
 * Split a face with a line from one edge to another
 * @param {Face} face - Face to split
 * @param {object} startEdge - {edge, point, t} for start point
 * @param {object} endEdge - {edge, point, t} for end point
 * @param {number} nextFaceId - ID for new face
 * @returns {{face1: Face, face2: Face}|null}
 */
export function splitFace(face, startEdge, endEdge, nextFaceId) {
  if (startEdge.edge.startIndex === endEdge.edge.startIndex) return null;

  try {
    const Face = face.constructor;
    const vertices = face.vertices;
    const uvs = face.uvs;
    const n = vertices.length;

    const startIdx = startEdge.edge.startIndex;
    const endIdx = endEdge.edge.startIndex;

    // Use copy/clone to ensure no reference sharing
    const newVertex1 = new THREE.Vector3().copy(startEdge.point);
    const newVertex2 = new THREE.Vector3().copy(endEdge.point);

    // Safer UV interpolation
    const startUV = uvs[startIdx] || new THREE.Vector2(0,0);
    const startNextUV = uvs[(startIdx + 1) % n] || new THREE.Vector2(0,0);
    const newUV1 = new THREE.Vector2().lerpVectors(startUV, startNextUV, startEdge.t);

    const endUV = uvs[endIdx] || new THREE.Vector2(0,0);
    const endNextUV = uvs[(endIdx + 1) % n] || new THREE.Vector2(0,0);
    const newUV2 = new THREE.Vector2().lerpVectors(endUV, endNextUV, endEdge.t);

    const face1Verts = [];
    const face1UVs = [];
    const face2Verts = [];
    const face2UVs = [];

    // --- Build Face 1 ---
    face1Verts.push(newVertex1.clone());
    face1UVs.push(newUV1.clone());

    let i = (startEdge.edge.endIndex) % n;
    let safety = 0;
    while(true) {
        face1Verts.push(vertices[i].clone());
        face1UVs.push(uvs[i].clone());
        if (i === endEdge.edge.startIndex) break;
        i = (i + 1) % n;
        if (safety++ > n * 2) throw new Error("Loop Error Face 1"); 
    }

    face1Verts.push(newVertex2.clone());
    face1UVs.push(newUV2.clone());

    // --- Build Face 2 ---
    face2Verts.push(newVertex2.clone());
    face2UVs.push(newUV2.clone());

    i = (endEdge.edge.endIndex) % n;
    safety = 0;
    while(true) {
        face2Verts.push(vertices[i].clone());
        face2UVs.push(uvs[i].clone());
        if (i === startEdge.edge.startIndex) break;
        i = (i + 1) % n;
        if (safety++ > n * 2) throw new Error("Loop Error Face 2");
    }

    face2Verts.push(newVertex1.clone());
    face2UVs.push(newUV1.clone());

    return { 
        face1: new Face(face.id, face1Verts, face1UVs), 
        face2: new Face(nextFaceId, face2Verts, face2UVs) 
    };

  } catch(e) {
    console.error("Split Face Failed:", e);
    return null;
  }
}


/**
 * Find the intersection of an infinite line with an edge segment
 * @param {THREE.Vector3} linePoint1 - First point on the infinite line
 * @param {THREE.Vector3} linePoint2 - Second point on the infinite line
 * @param {THREE.Vector3} edgeStart - Start of edge segment
 * @param {THREE.Vector3} edgeEnd - End of edge segment
 * @returns {{point: THREE.Vector3, t: number}|null} - Intersection point and t parameter (0-1 along edge)
 */


/**
 * Find the intersection of an infinite line with an edge segment in 3D
 * Projects onto the face's dominant plane to ensure accuracy for walls/slopes
 */
function lineEdgeIntersection(linePoint1, linePoint2, edgeStart, edgeEnd, faceNormal) {
  // 1. Determine the dominant axis of the face normal to project to 2D reliably
  // This avoids "dividing by zero" issues when cutting vertical walls
  let u = 'x', v = 'y';
  const nx = Math.abs(faceNormal.x);
  const ny = Math.abs(faceNormal.y);
  const nz = Math.abs(faceNormal.z);

  // If Z is normal (floor), use XY. If X is normal (wall), use YZ, etc.
  if (nx > ny && nx > nz) { u = 'y'; v = 'z'; }
  else if (ny > nx && ny > nz) { u = 'x'; v = 'z'; }
  else { u = 'x'; v = 'y'; }

  // 2. Project points to 2D
  const a1 = linePoint1[u], b1 = linePoint1[v];
  const a2 = linePoint2[u], b2 = linePoint2[v];
  const a3 = edgeStart[u], b3 = edgeStart[v];
  const a4 = edgeEnd[u], b4 = edgeEnd[v];

  // 3. Calculate 2D intersection
  const denom = (a1 - a2) * (b3 - b4) - (b1 - b2) * (a3 - a4);
  
  // Parallel lines check
  if (Math.abs(denom) < 0.00001) return null;

  // We only need 'mu', the parameter along the edge segment (3->4)
  // Intersection = P3 + mu * (P4 - P3)
  const mu = -((a1 - a2) * (b1 - b3) - (b1 - b2) * (a1 - a3)) / denom;

  // 4. Strict bound check with epsilon
  // Must be strictly inside the edge (0 < mu < 1) to avoid duplicate vertex issues at corners
  if (mu < 0.001 || mu > 0.999) return null;

  const point = new THREE.Vector3().lerpVectors(edgeStart, edgeEnd, mu);
  return { point, t: mu };
}


/**
 * Helper to compute normal for arbitrary face polygon
 */
function getFaceNormal(face) {
  // Assuming face.vertices has at least 3 vertices
  const vA = face.vertices[0];
  const vB = face.vertices[1];
  const vC = face.vertices[2];
  
  const cb = new THREE.Vector3().subVectors(vC, vB);
  const ab = new THREE.Vector3().subVectors(vA, vB);
  
  // Cross product gives normal
  return cb.cross(ab).normalize();
}



/**
 * Find all faces that an infinite line passes through
 * @param {Array<Face>} faces - All faces in the mesh
 * @param {THREE.Vector3} linePoint1 - First point defining the cut line
 * @param {THREE.Vector3} linePoint2 - Second point defining the cut line
 * @param {Face} excludeFace - Face to exclude (the one being cut directly)
 * @returns {Array<{face: Face, startEdge: object, endEdge: object}>}
 */
export function findFacesOnLine(faces, linePoint1, linePoint2, excludeFace = null) {
  const results = [];

  for (const face of faces) {
    if (excludeFace && face.id === excludeFace.id) continue;

    // Calculate normal so we know which plane this face lives on
    const normal = getFaceNormal(face);
    const edges = face.getEdges();
    const intersections = [];

    for (const edge of edges) {
      // PASS NORMAL HERE
      const intersection = lineEdgeIntersection(linePoint1, linePoint2, edge.start, edge.end, normal);
      if (intersection) {
        intersections.push({
          edge: edge,
          point: intersection.point,
          t: intersection.t
        });
      }
    }

    // A valid cut through a convex face must enter one edge and exit another
    if (intersections.length === 2) {
      if (intersections[0].edge.startIndex !== intersections[1].edge.startIndex) {
        results.push({
          face: face,
          startEdge: intersections[0],
          endEdge: intersections[1]
        });
      }
    }
  }

  return results;
}



/**
 * Find where a plane intersects a line segment
 * @param {THREE.Plane} plane - The cutting plane
 * @param {THREE.Vector3} lineStart - Start of line segment
 * @param {THREE.Vector3} lineEnd - End of line segment
 * @returns {{point: THREE.Vector3, t: number}|null} - Intersection point and parameter, or null
 */
function planeEdgeIntersection(plane, lineStart, lineEnd) {
  const direction = new THREE.Vector3().subVectors(lineEnd, lineStart);
  const length = direction.length();
  if (length < 0.0001) return null;

  direction.normalize();

  // Ray-plane intersection
  const denominator = plane.normal.dot(direction);
  if (Math.abs(denominator) < 0.00001) return null; // Line parallel to plane

  const t = -(plane.normal.dot(lineStart) + plane.constant) / denominator;

  // Check if intersection is within segment (with small epsilon)
  if (t < 0.001 * length || t > 0.999 * length) return null;

  const point = new THREE.Vector3().copy(lineStart).addScaledVector(direction, t);
  return { point, t: t / length };
}

/**
 * Find all faces intersected by a cutting plane
 * @param {Array<Face>} faces - All faces
 * @param {THREE.Plane} plane - The cutting plane
 * @returns {Array} - Faces with their intersection points
 */
function findFacesOnPlane(faces, plane) {
  const results = [];

  for (const face of faces) {
    const edges = face.getEdges();
    const intersections = [];

    for (const edge of edges) {
      const intersection = planeEdgeIntersection(plane, edge.start, edge.end);
      if (intersection) {
        intersections.push({
          edge: edge,
          point: intersection.point,
          t: intersection.t
        });
      }
    }

    // A valid cut through a convex face must have exactly 2 edge intersections
    if (intersections.length === 2) {
      if (intersections[0].edge.startIndex !== intersections[1].edge.startIndex) {
        results.push({
          face: face,
          startEdge: intersections[0],
          endEdge: intersections[1]
        });
      }
    }
  }

  return results;
}

/**
 * Slices the mesh along a line defined by two points
 * Uses a cutting plane when camera direction is provided for true 3D cuts
 * @param {Array<Face>} faces - The list of faces in your mesh
 * @param {THREE.Vector3} startPoint - 3D start point of cut
 * @param {THREE.Vector3} endPoint - 3D end point of cut
 * @param {THREE.Vector3} [cameraDirection] - Camera view direction for 3D plane cut
 * @returns {Array<Face>} - The new list of faces (replacing the old ones)
 */
export function sliceMesh(faces, startPoint, endPoint, cameraDirection = null) {
  let cuts;

  if (cameraDirection) {
    // Create a cutting plane from the cut line and camera direction
    // The plane normal is perpendicular to both the cut line and camera direction
    const cutDirection = new THREE.Vector3().subVectors(endPoint, startPoint).normalize();
    const planeNormal = new THREE.Vector3().crossVectors(cutDirection, cameraDirection).normalize();

    // If the cross product is zero (cut line parallel to camera), fall back to old method
    if (planeNormal.length() < 0.001) {
      cuts = findFacesOnLine(faces, startPoint, endPoint);
    } else {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, startPoint);
      cuts = findFacesOnPlane(faces, plane);
    }
  } else {
    // Fall back to old 2D method
    cuts = findFacesOnLine(faces, startPoint, endPoint);
  }

  if (cuts.length === 0) return faces;

  const newFaces = [...faces];
  const facesToRemove = new Set();
  const facesToAdd = [];

  let nextId = Math.max(...faces.map(f => f.id)) + 1;

  for (const cut of cuts) {
    const result = splitFace(cut.face, cut.startEdge, cut.endEdge, nextId);
    if (result) {
      facesToRemove.add(cut.face);
      facesToAdd.push(result.face1, result.face2);
      nextId++;
    }
  }

  return newFaces.filter(f => !facesToRemove.has(f)).concat(facesToAdd);
}


/**
 * Cut overlay for drawing cut lines on the mesh
 */
export class CutOverlay {
  constructor(canvas, sceneManager) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sceneManager = sceneManager;

    this.startPoint = null;     // Screen coordinates of start
    this.startEdge = null;      // 3D edge data for start
    this.startFace = null;      // Face being cut
    this.hoverEdge = null;      // Current edge being hovered
    this.hoverPoint = null;     // Screen coords of hover point
    this.hoverFace = null;      // Face being hovered
    this.isActive = false;

    // Mode: 'edge' or 'face'
    this.mode = 'edge';

    // Face mode state
    this.faceStartPoint = null;   // 3D point on face for first click
    this.faceEndPoint = null;     // 3D point on face for second click
    this.faceHoverPoint = null;   // 3D point being hovered in face mode

    // Mode toolbar elements
    this.modeToolbar = document.getElementById('mode-toolbar');
    this.modeEdgeBtn = document.getElementById('mode-edge');
    this.modeFaceBtn = document.getElementById('mode-face');

    // Style
    this.lineColor = '#ff7f29bd';       // for cut line
    this.edgeColor = '#ff7f29ff';   //FFC64Cff     // for edge highlight
    this.invalidColor = '#EA1941';    // Red for invalid
    this.facePointColor = '#4CAF50';  // Green for face points

    // Callbacks
    this.onCutComplete = null;
    this.onReady = null;  // Called when cut is ready for approval
    this.onModeChange = null;  // Called when mode is toggled (edge/face)

    // Pending cut data
    this.pendingCut = null;

    // Rotation state for 3D navigation
    this.isRotating = false;

    // Drag state for repositioning points
    this.isDragging = false;
    this.dragTarget = null;  // 'start', 'faceStart'
    this.wasDragging = false;  // To suppress click after drag

    // Multi-touch/pinch state - tracked via pointer events
    this.activePointers = new Map();
    this.isPinching = false;
    this.pinchEndTimer = null;

    this.handleResize = this.handleResize.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerClick = this.handlePointerClick.bind(this);
    this.handleModeChange = this.handleModeChange.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);

    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  /**
   * Set the editable mesh for cut detection
   * @param {EditableMesh} editableMesh
   */
  setMesh(editableMesh) {
    this.editableMesh = editableMesh;
  }

  activate() {
    this.canvas.style.display = 'block';
    this.canvas.classList.add('active');
    this.isActive = true;

    // Ensure touch-action is set so all touches become pointer events
    this.canvas.style.touchAction = 'none';

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('click', this.handlePointerClick);
    // Use window for pointerup/cancel to catch it even when pointer events are disabled on overlay
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerCancel);

    // Show mode toolbar and add listeners
    if (this.modeToolbar) {
      this.modeToolbar.style.display = 'flex';
      this.modeEdgeBtn.addEventListener('click', this.handleModeChange);
      this.modeFaceBtn.addEventListener('click', this.handleModeChange);
    }

    // Enable controls for zooming (wheel events forwarded globally from main.js)
    this.sceneManager.setControlsEnabled(true);

    this.reset();
    this.draw();
  }

  deactivate() {
    this.canvas.style.display = 'none';
    this.canvas.classList.remove('active');
    this.isActive = false;

    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('click', this.handlePointerClick);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerCancel);

    // Hide mode toolbar and remove listeners
    if (this.modeToolbar) {
      this.modeToolbar.style.display = 'none';
      this.modeEdgeBtn.removeEventListener('click', this.handleModeChange);
      this.modeFaceBtn.removeEventListener('click', this.handleModeChange);
    }

    // Ensure controls are re-enabled and pointer events restored
    this.canvas.style.pointerEvents = 'auto';
    this.isRotating = false;
    this.isPinching = false;
    this.activePointers.clear();
    if (this.pinchEndTimer) {
      clearTimeout(this.pinchEndTimer);
      this.pinchEndTimer = null;
    }
    this.sceneManager.setControlsEnabled(true);
  }

  /**
   * Handle mode toggle button click
   */
  handleModeChange(e) {
    const btn = e.currentTarget;
    const newMode = btn.id === 'mode-edge' ? 'edge' : 'face';
    this.setMode(newMode);
  }

  /**
   * Set the cut mode directly
   * @param {string} mode - 'edge' or 'face'
   */
  setMode(mode) {
    if (mode !== this.mode) {
      this.mode = mode;
      this.updateModeButtons();

      // Notify listeners
      if (this.onModeChange) {
        this.onModeChange(mode);
      }

      // Only reset partial state (not yet finalized cuts)
      // Preserve pendingCut so finalized lines stay visible when switching modes
      if (!this.pendingCut) {
        this.reset();
      } else {
        // Clear only the mode-specific hover/partial state, keep pendingCut
        this.clearPartialState();
      }
      this.draw();
    }
  }

  /**
   * Clear partial state (start/hover points) without clearing pending cut
   */
  clearPartialState() {
    // Edge mode state
    this.startPoint = null;
    this.startEdge = null;
    this.startFace = null;
    this.hoverEdge = null;
    this.hoverFace = null;
    this.hoverPoint = null;

    // Face mode state
    this.faceStartPoint = null;
    this.faceEndPoint = null;
    this.faceHoverPoint = null;

    // Clear drag state
    this.isDragging = false;
    this.dragTarget = null;
    this.wasDragging = false;
  }

  /**
   * Toggle between edge and face modes
   * @returns {string} The new mode
   */
  toggleMode() {
    const newMode = this.mode === 'edge' ? 'face' : 'edge';
    this.setMode(newMode);
    return newMode;
  }

  /**
   * Update mode button active states
   */
  updateModeButtons() {
    if (this.modeEdgeBtn) {
      this.modeEdgeBtn.classList.toggle('active', this.mode === 'edge');
    }
    if (this.modeFaceBtn) {
      this.modeFaceBtn.classList.toggle('active', this.mode === 'face');
    }
  }

  handleResize() {
    const container = this.canvas.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;

    this.draw();
  }

  /**
   * Raycast to find the closest edge at screen position
   */
  findEdgeAtPosition(clientX, clientY) {
    if (!this.editableMesh || !this.editableMesh.mesh) return null;

    const ndc = this.sceneManager.screenToNDC(clientX, clientY);
    const raycaster = this.sceneManager.getRaycaster(ndc.x, ndc.y);
    const intersects = raycaster.intersectObject(this.editableMesh.mesh);

    if (intersects.length === 0) return null;

    const hitPoint = intersects[0].point;

    // Find closest edge to hit point
    let closestEdge = null;
    let closestFace = null;

    for (const face of this.editableMesh.faces) {
      const edge = findClosestEdge(hitPoint, face, 0.3);
      if (edge && (!closestEdge || edge.point.distanceTo(hitPoint) < closestEdge.point.distanceTo(hitPoint))) {
        closestEdge = edge;
        closestFace = face;
      }
    }

    if (!closestEdge) return null;

    return { edge: closestEdge, face: closestFace };
  }

  /**
   * Raycast to find the hit point on a face (for face mode)
   */
  findFaceAtPosition(clientX, clientY) {
    if (!this.editableMesh || !this.editableMesh.mesh) return null;

    const ndc = this.sceneManager.screenToNDC(clientX, clientY);
    const raycaster = this.sceneManager.getRaycaster(ndc.x, ndc.y);
    const intersects = raycaster.intersectObject(this.editableMesh.mesh);

    if (intersects.length === 0) return null;

    const hitPoint = intersects[0].point;
    const faceIndex = intersects[0].faceIndex;

    // Find which face was hit using triangle-to-face mapping
    let hitFace = null;
    if (this.editableMesh.findFaceByTriangleIndex) {
      hitFace = this.editableMesh.findFaceByTriangleIndex(faceIndex);
    }

    // Fallback: find face containing the hit point
    if (!hitFace) {
      for (const face of this.editableMesh.faces) {
        if (this.editableMesh.isPointInFace(hitPoint, face)) {
          hitFace = face;
          break;
        }
      }
    }

    return { point: hitPoint.clone(), face: hitFace };
  }

  /**
   * Calculate where a line through two points intersects the edges of faces
   * Returns the two edge intersection points that are closest to the input points
   */
  calculateCutFromFacePoints(point1, point2) {
    if (!this.editableMesh) return null;

    const faces = this.editableMesh.faces;
    const allIntersections = [];

    // Find all edge intersections
    for (const face of faces) {
      const normal = face.normal || this.getFaceNormal(face);
      const edges = face.getEdges();

      for (const edge of edges) {
        const intersection = this.lineEdgeIntersection3D(point1, point2, edge.start, edge.end, normal);
        if (intersection) {
          allIntersections.push({
            point: intersection.point,
            t: intersection.t,
            edge: edge,
            face: face
          });
        }
      }
    }

    if (allIntersections.length < 2) return null;

    // Find the intersection closest to point1 and point2
    let closestToStart = null;
    let closestToEnd = null;
    let minDistStart = Infinity;
    let minDistEnd = Infinity;

    for (const intersection of allIntersections) {
      const distToStart = intersection.point.distanceTo(point1);
      const distToEnd = intersection.point.distanceTo(point2);

      if (distToStart < minDistStart) {
        minDistStart = distToStart;
        closestToStart = intersection;
      }
      if (distToEnd < minDistEnd) {
        minDistEnd = distToEnd;
        closestToEnd = intersection;
      }
    }

    // Make sure we have two different intersections
    if (!closestToStart || !closestToEnd || closestToStart === closestToEnd) {
      return null;
    }

    return {
      startPoint: closestToStart.point,
      endPoint: closestToEnd.point,
      startEdge: closestToStart,
      endEdge: closestToEnd
    };
  }

  /**
   * Line-edge intersection in 3D (similar to existing but returns result directly)
   */
  lineEdgeIntersection3D(linePoint1, linePoint2, edgeStart, edgeEnd, faceNormal) {
    // Determine dominant plane for projection
    let u = 'x', v = 'y';
    const nx = Math.abs(faceNormal.x);
    const ny = Math.abs(faceNormal.y);
    const nz = Math.abs(faceNormal.z);

    if (nx > ny && nx > nz) { u = 'y'; v = 'z'; }
    else if (ny > nx && ny > nz) { u = 'x'; v = 'z'; }
    else { u = 'x'; v = 'y'; }

    // Project to 2D
    const a1 = linePoint1[u], b1 = linePoint1[v];
    const a2 = linePoint2[u], b2 = linePoint2[v];
    const a3 = edgeStart[u], b3 = edgeStart[v];
    const a4 = edgeEnd[u], b4 = edgeEnd[v];

    const denom = (a1 - a2) * (b3 - b4) - (b1 - b2) * (a3 - a4);
    if (Math.abs(denom) < 0.00001) return null;

    const mu = -((a1 - a2) * (b1 - b3) - (b1 - b2) * (a1 - a3)) / denom;

    // Must be inside edge (with small epsilon)
    if (mu < 0.001 || mu > 0.999) return null;

    const point = new THREE.Vector3().lerpVectors(edgeStart, edgeEnd, mu);
    return { point, t: mu };
  }

  getFaceNormal(face) {
    const vA = face.vertices[0];
    const vB = face.vertices[1];
    const vC = face.vertices[2];
    const cb = new THREE.Vector3().subVectors(vC, vB);
    const ab = new THREE.Vector3().subVectors(vA, vB);
    return cb.cross(ab).normalize();
  }

  /**
   * Convert 3D point to screen coordinates
   */
  worldToScreen(point) {
    const vector = point.clone();
    vector.project(this.sceneManager.camera);

    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (vector.x * 0.5 + 0.5) * rect.width,
      y: (-vector.y * 0.5 + 0.5) * rect.height
    };
  }

  /**
   * Check if a screen position is near an existing cut point
   * @returns {string|null} - 'start', 'end', 'faceStart', 'faceEnd', 'pendingStart', 'pendingEnd', or null
   */
  getPointAtPosition(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const threshold = 20; // pixels

    // Check pending cut points first (highest priority - the finalized cut line)
    if (this.pendingCut) {
      const startScreen = this.worldToScreen(this.pendingCut.startPoint);
      const endScreen = this.worldToScreen(this.pendingCut.endPoint);

      const distStart = Math.hypot(x - startScreen.x, y - startScreen.y);
      const distEnd = Math.hypot(x - endScreen.x, y - endScreen.y);

      // Return the closer one if both are within threshold
      if (distStart < threshold && distEnd < threshold) {
        return distStart < distEnd ? 'pendingStart' : 'pendingEnd';
      }
      if (distStart < threshold) return 'pendingStart';
      if (distEnd < threshold) return 'pendingEnd';
    }

    if (this.mode === 'face') {
      // Check face start point
      if (this.faceStartPoint) {
        const screen = this.worldToScreen(this.faceStartPoint);
        const dist = Math.hypot(x - screen.x, y - screen.y);
        if (dist < threshold) return 'faceStart';
      }
      // Check face end point (when hovering to place second point)
      if (this.faceEndPoint) {
        const screen = this.worldToScreen(this.faceEndPoint);
        const dist = Math.hypot(x - screen.x, y - screen.y);
        if (dist < threshold) return 'faceEnd';
      }
    } else {
      // Edge mode - check start point
      if (this.startPoint) {
        const dist = Math.hypot(x - this.startPoint.x, y - this.startPoint.y);
        if (dist < threshold) return 'start';
      }
      // Edge mode - check hover/end point
      if (this.hoverPoint && this.hoverEdge) {
        const dist = Math.hypot(x - this.hoverPoint.x, y - this.hoverPoint.y);
        if (dist < threshold) return 'end';
      }
    }

    return null;
  }

  handlePointerDown(e) {
    // Track all active pointers for multi-touch detection
    this.activePointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType
    });

    // If we have 2+ pointers, enter pinch mode
    // Simply disable the overlay - user will need to start a fresh pinch on the renderer
    if (this.activePointers.size >= 2) {
      this.isPinching = true;
      this.canvas.style.pointerEvents = 'none';
      // Clear pointer tracking since we're handing off to OrbitControls
      this.activePointers.clear();
      return;
    }

    // Check if clicking on an existing point to start dragging
    const pointTarget = this.getPointAtPosition(e.clientX, e.clientY);
    if (pointTarget) {
      this.isDragging = true;
      this.dragTarget = pointTarget;
      e.preventDefault();
      return;
    }

    // Handle face mode
    if (this.mode === 'face') {
      const result = this.findFaceAtPosition(e.clientX, e.clientY);

      if (!result || !result.face) {
        // Clicked on empty space - reset state if we had a start point
        if (this.faceStartPoint) {
          this.reset();
          this.draw();
        }

        // Allow 3D rotation
        this.enableRotation(e);
        return;
      }

      // Face mode click is handled in handlePointerClick
      return;
    }

    // Edge mode (original behavior)
    const result = this.findEdgeAtPosition(e.clientX, e.clientY);

    if (!result) {
      // Clicked on empty space - reset the cut state if we had a start point
      if (this.startPoint) {
        this.reset();
        this.draw();
      }

      // Allow 3D rotation
      this.enableRotation(e);
      return;
    }

    // Only set start point if we don't already have one
    if (!this.startPoint) {
      // Set start point for cut
      this.startPoint = this.worldToScreen(result.edge.point);
      this.startEdge = result.edge;
      this.startFace = result.face;

      this.draw();
    }
  }

  /**
   * Enable 3D rotation by disabling overlay pointer events
   */
  enableRotation(e) {
    this.canvas.style.pointerEvents = 'none';
    this.sceneManager.setControlsEnabled(true);
    this.isRotating = true;

    // Dispatch a new pointerdown event to the 3D canvas so OrbitControls receives it
    const renderer = this.sceneManager.renderer;
    if (renderer && renderer.domElement) {
      const syntheticEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        button: e.button,
        buttons: e.buttons
      });
      renderer.domElement.dispatchEvent(syntheticEvent);
    }
  }

  /**
   * Execute the pending cut
   */
  executePendingCut() {
    if (this.pendingCut && this.onCutComplete) {
      // Pass just the points. The manager will handle finding the faces.
      this.onCutComplete(this.pendingCut.startPoint, this.pendingCut.endPoint);
    }
    this.pendingCut = null;
    this.reset();
    this.draw();
  }

  /**
   * Cancel the pending cut
   */
  cancelPendingCut() {
    this.pendingCut = null;
    this.reset();
    this.draw();
  }

  handlePointerMove(e) {
    // Update cursor based on whether we're over a draggable point
    if (!this.isDragging) {
      const pointTarget = this.getPointAtPosition(e.clientX, e.clientY);
      this.canvas.style.cursor = pointTarget ? 'grab' : 'crosshair';
    } else {
      this.canvas.style.cursor = 'grabbing';
    }

    // Handle dragging of existing points
    if (this.isDragging && this.dragTarget) {
      if (this.dragTarget === 'pendingStart' || this.dragTarget === 'pendingEnd') {
        // Dragging a pending cut endpoint - update in 3D space
        const result = this.findEdgeAtPosition(e.clientX, e.clientY);
        if (result) {
          if (this.dragTarget === 'pendingStart') {
            this.pendingCut.startPoint = result.edge.point.clone();
          } else {
            this.pendingCut.endPoint = result.edge.point.clone();
          }
        }
      } else if (this.dragTarget === 'faceStart') {
        // Drag face start point to new position on face
        const result = this.findFaceAtPosition(e.clientX, e.clientY);
        if (result && result.face) {
          this.faceStartPoint = result.point.clone();
          this.startFace = result.face;
        }
      } else if (this.dragTarget === 'faceEnd') {
        // Drag face end point to new position on face
        const result = this.findFaceAtPosition(e.clientX, e.clientY);
        if (result && result.face) {
          this.faceEndPoint = result.point.clone();
        }
      } else if (this.dragTarget === 'start') {
        // Drag edge start point to a new edge
        const result = this.findEdgeAtPosition(e.clientX, e.clientY);
        if (result) {
          this.startPoint = this.worldToScreen(result.edge.point);
          this.startEdge = result.edge;
          this.startFace = result.face;
        }
      } else if (this.dragTarget === 'end') {
        // Drag edge end/hover point to a new edge
        const result = this.findEdgeAtPosition(e.clientX, e.clientY);
        if (result) {
          this.hoverPoint = this.worldToScreen(result.edge.point);
          this.hoverEdge = result.edge;
          this.hoverFace = result.face;
        }
      }
      this.draw();
      return;
    }

    // Handle face mode
    if (this.mode === 'face') {
      const result = this.findFaceAtPosition(e.clientX, e.clientY);

      if (result && result.face) {
        this.faceHoverPoint = result.point;
        this.hoverFace = result.face;
      } else {
        this.faceHoverPoint = null;
        this.hoverFace = null;
      }

      this.draw();
      return;
    }

    // Edge mode (original behavior)
    const result = this.findEdgeAtPosition(e.clientX, e.clientY);

    if (result) {
      this.hoverEdge = result.edge;
      this.hoverFace = result.face;
      this.hoverPoint = this.worldToScreen(result.edge.point);
    } else {
      this.hoverEdge = null;
      this.hoverFace = null;
      this.hoverPoint = null;
    }

    this.draw();
  }

  handlePointerClick(e) {
    // Skip click if we just finished dragging
    if (this.wasDragging) {
      this.wasDragging = false;
      return;
    }

    // Handle face mode
    if (this.mode === 'face') {
      const result = this.findFaceAtPosition(e.clientX, e.clientY);
      if (!result || !result.face) return;

      // First click - set start point
      if (!this.faceStartPoint) {
        this.faceStartPoint = result.point.clone();
        this.startFace = result.face;
        this.draw();
        return;
      }

      // Second click - calculate cut from face points
      this.faceEndPoint = result.point.clone();

      // Calculate where the line through the two points intersects edges
      const cutResult = this.calculateCutFromFacePoints(this.faceStartPoint, this.faceEndPoint);

      if (cutResult) {
        // Store the cut data using the calculated edge intersection points
        this.pendingCut = {
          startPoint: cutResult.startPoint,
          endPoint: cutResult.endPoint
        };

        // Redraw to show the calculated cut line
        this.draw();

        // Show approval button
        if (this.onReady) {
          this.onReady();
        }
      } else {
        // No valid cut found - reset face points to try again
        this.faceStartPoint = null;
        this.faceEndPoint = null;
        this.draw();
      }
      return;
    }

    // Edge mode (original behavior)
    // Only process clicks on edges (not empty space)
    const result = this.findEdgeAtPosition(e.clientX, e.clientY);
    if (!result) return;

    // If we don't have a start point yet, this click sets it (handled in handlePointerDown)
    if (!this.startPoint) return;

    // We have a start point and clicked on an edge - check if it's a valid second point
    // Use the freshly computed result instead of hover state
    const clickedEdge = result.edge;

    const isValidCut = clickedEdge &&
      clickedEdge.edge.startIndex !== this.startEdge.edge.startIndex;

    if (isValidCut) {
      // Update hover state to show where we clicked
      this.hoverEdge = clickedEdge;
      this.hoverFace = result.face;
      this.hoverPoint = this.worldToScreen(clickedEdge.point);

      // Store the cut data
      this.pendingCut = {
        startPoint: this.startEdge.point,
        endPoint: clickedEdge.point
      };

      // Redraw to show the cut line
      this.draw();

      // Show approval button
      if (this.onReady) {
        this.onReady();
      }
    }
  }

  handlePointerUp(e) {
    // Remove the pointer from tracking
    this.activePointers.delete(e.pointerId);

    // When pinching, we cleared activePointers, so we need a different way to detect
    // when to re-enable the overlay. Use a short debounce to wait for all fingers to lift.
    if (this.isPinching) {
      // Clear any existing debounce timer
      if (this.pinchEndTimer) {
        clearTimeout(this.pinchEndTimer);
      }
      // Wait a short time for all pointerup events to fire, then re-enable overlay
      this.pinchEndTimer = setTimeout(() => {
        this.isPinching = false;
        this.canvas.style.pointerEvents = 'auto';
        this.activePointers.clear();
        this.pinchEndTimer = null;
      }, 100);
      return;
    }

    // End dragging
    if (this.isDragging) {
      this.isDragging = false;
      this.dragTarget = null;
      this.wasDragging = true;  // Suppress upcoming click event
      this.draw();
      return;
    }

    // Re-enable pointer events on overlay after rotation
    if (this.isRotating) {
      this.isRotating = false;
      this.canvas.style.pointerEvents = 'auto';
      // Keep controls enabled for wheel zoom - only disable rotation dragging
      // by restoring pointer events on overlay
    }
  }

  handlePointerCancel(e) {
    // Pointer was cancelled (e.g., by browser, system gesture, etc.)
    // Aggressively reset state to recover
    this.activePointers.delete(e.pointerId);

    if (this.isPinching) {
      if (this.pinchEndTimer) {
        clearTimeout(this.pinchEndTimer);
      }
      // Immediately restore overlay on cancel
      this.isPinching = false;
      this.canvas.style.pointerEvents = 'auto';
      this.activePointers.clear();
      this.pinchEndTimer = null;
    }

    if (this.isRotating) {
      this.isRotating = false;
      this.canvas.style.pointerEvents = 'auto';
    }

    if (this.isDragging) {
      this.isDragging = false;
      this.dragTarget = null;
      this.wasDragging = false;
    }
  }

  getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  reset() {
    // Edge mode state
    this.startPoint = null;
    this.startEdge = null;
    this.startFace = null;
    this.hoverEdge = null;
    this.hoverFace = null;
    this.hoverPoint = null;

    // Face mode state
    this.faceStartPoint = null;
    this.faceEndPoint = null;
    this.faceHoverPoint = null;

    // Clear pending cut
    this.pendingCut = null;

    // Clear drag state
    this.isDragging = false;
    this.dragTarget = null;
    this.wasDragging = false;
  }

  draw() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!this.isActive) return;

    // Face mode visualization
    if (this.mode === 'face') {
      // Draw hover point on face (when no start point set)
      if (!this.faceStartPoint && this.faceHoverPoint) {
        const hoverScreen = this.worldToScreen(this.faceHoverPoint);

        // Draw hover point marker (green)
        ctx.fillStyle = this.facePointColor;
        ctx.beginPath();
        ctx.arc(hoverScreen.x, hoverScreen.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(hoverScreen.x, hoverScreen.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw start point when set
      if (this.faceStartPoint && !this.pendingCut) {
        const startScreen = this.worldToScreen(this.faceStartPoint);

        // Draw start point marker (green)
        ctx.fillStyle = this.facePointColor;
        ctx.beginPath();
        ctx.arc(startScreen.x, startScreen.y, 10, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(startScreen.x, startScreen.y, 5, 0, Math.PI * 2);
        ctx.fill();

        // Draw preview line to hover point
        if (this.faceHoverPoint) {
          const hoverScreen = this.worldToScreen(this.faceHoverPoint);

          // Draw dashed preview line
          ctx.strokeStyle = this.facePointColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);

          ctx.beginPath();
          ctx.moveTo(startScreen.x, startScreen.y);
          ctx.lineTo(hoverScreen.x, hoverScreen.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Draw hover point marker
          ctx.fillStyle = this.facePointColor;
          ctx.beginPath();
          ctx.arc(hoverScreen.x, hoverScreen.y, 8, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(hoverScreen.x, hoverScreen.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (!this.pendingCut) {
      // Edge mode visualization (only when no pending cut - pending cut has its own white line)

      // Determine if current hover is a valid cut target
      // Use ID comparison for robustness
      const isValidCut = this.startPoint &&
        this.hoverEdge &&
        this.hoverFace && this.startFace &&
      //  this.hoverFace.id === this.startFace.id && // this was causing issues with cutting of lines
        this.hoverEdge.edge.startIndex !== this.startEdge.edge.startIndex;

      // Draw hover edge highlight (when no start point set)
      if (!this.startPoint && this.hoverPoint) {
        this.drawEdgeHighlight(this.hoverEdge, this.edgeColor);

        // Draw hover point marker
        ctx.fillStyle = this.edgeColor;
        ctx.beginPath();
        ctx.arc(this.hoverPoint.x, this.hoverPoint.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(this.hoverPoint.x, this.hoverPoint.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw start point when set
      if (this.startPoint) {
        // Draw the start edge highlight
        this.drawEdgeHighlight(this.startEdge, this.lineColor);

        // Draw start point marker
        ctx.fillStyle = this.lineColor;
        ctx.beginPath();
        ctx.arc(this.startPoint.x, this.startPoint.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(this.startPoint.x, this.startPoint.y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Draw cut preview line if hovering a valid edge
        if (this.hoverPoint) {
          const lineColor = isValidCut ? this.lineColor : this.invalidColor;

          // Draw the cut line
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 3;
          ctx.setLineDash([]);

          ctx.beginPath();
          ctx.moveTo(this.startPoint.x, this.startPoint.y);
          ctx.lineTo(this.hoverPoint.x, this.hoverPoint.y);
          ctx.stroke();

          // Draw hover edge highlight
          this.drawEdgeHighlight(this.hoverEdge, isValidCut ? this.edgeColor : this.invalidColor);

          // Draw hover point marker
          ctx.fillStyle = isValidCut ? this.edgeColor : this.invalidColor;
          ctx.beginPath();
          ctx.arc(this.hoverPoint.x, this.hoverPoint.y, 8, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(this.hoverPoint.x, this.hoverPoint.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Draw pending cut line (waiting for approval)
    if (this.pendingCut) {
      const startScreen = this.worldToScreen(this.pendingCut.startPoint);
      const endScreen = this.worldToScreen(this.pendingCut.endPoint);

      // Draw white cut line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(startScreen.x, startScreen.y);
      ctx.lineTo(endScreen.x, endScreen.y);
      ctx.stroke();

      // Draw start point marker
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(startScreen.x, startScreen.y, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(startScreen.x, startScreen.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Draw end point marker
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(endScreen.x, endScreen.y, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(endScreen.x, endScreen.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Draw a highlighted edge
   */
  drawEdgeHighlight(edgeData, color) {
    if (!edgeData || !edgeData.edge) return;

    const start = this.worldToScreen(edgeData.edge.start);
    const end = this.worldToScreen(edgeData.edge.end);

    const ctx = this.ctx;

    // Draw edge line
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.deactivate();
  }
}
