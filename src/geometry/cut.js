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
 * Slices the mesh along a line defined by two points
 * @param {Array<Face>} faces - The list of faces in your mesh
 * @param {THREE.Vector3} startPoint - 3D start point of cut
 * @param {THREE.Vector3} endPoint - 3D end point of cut
 * @returns {Array<Face>} - The new list of faces (replacing the old ones)
 */
export function sliceMesh(faces, startPoint, endPoint) {
  const cuts = findFacesOnLine(faces, startPoint, endPoint);
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

    // Style
    this.lineColor = '#9b59b6';       // Purple for cut line
    this.edgeColor = '#00ffff';       // Cyan for edge highlight
    this.invalidColor = '#ff4444';    // Red for invalid

    // Callbacks
    this.onCutComplete = null;
    this.onReady = null;  // Called when cut is ready for approval

    // Pending cut data
    this.pendingCut = null;

    // Rotation state for 3D navigation
    this.isRotating = false;

    this.handleResize = this.handleResize.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerClick = this.handlePointerClick.bind(this);

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

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('click', this.handlePointerClick);

    this.reset();
    this.draw();
  }

  deactivate() {
    this.canvas.style.display = 'none';
    this.canvas.classList.remove('active');
    this.isActive = false;

    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('click', this.handlePointerClick);

    // Ensure controls are re-enabled
    this.sceneManager.setControlsEnabled(true);
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

  handlePointerDown(e) {
    const result = this.findEdgeAtPosition(e.clientX, e.clientY);

    if (!result) {
      // Allow 3D rotation when clicking on empty space
      // Disable pointer events on overlay and dispatch event to 3D canvas
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
    // Only process clicks on edges (not empty space)
    const result = this.findEdgeAtPosition(e.clientX, e.clientY);
    if (!result) return;

    // If we don't have a start point yet, this click sets it (handled in handlePointerDown)
    if (!this.startPoint) return;

    // We have a start point and clicked on an edge - check if it's a valid second point
    if (this.hoverPoint && this.hoverFace && this.startFace) {
      const isValidCut = this.hoverEdge && 
        this.hoverEdge.edge.startIndex !== this.startEdge.edge.startIndex;

      if (isValidCut) {
        // Store the cut data
        this.pendingCut = {
          startPoint: this.startEdge.point,
          endPoint: this.hoverEdge.point
        };

        // Show approval button
        if (this.onReady) {
          this.onReady();
        }
      }
    }
  }

  handlePointerUp(e) {
    // Re-enable pointer events on overlay after rotation
    if (this.isRotating) {
      this.isRotating = false;
      this.canvas.style.pointerEvents = 'auto';
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
    this.startPoint = null;
    this.startEdge = null;
    this.startFace = null;
    this.hoverEdge = null;
    this.hoverFace = null;
    this.hoverPoint = null;
  }

  draw() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!this.isActive) return;

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
