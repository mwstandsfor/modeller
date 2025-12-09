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
  // Can't split if same edge
  if (startEdge.edge.startIndex === endEdge.edge.startIndex) {
    return null;
  }

  const Face = face.constructor;
  const vertices = face.vertices;
  const uvs = face.uvs;
  const n = vertices.length;

  // Get edge indices
  const startIdx = startEdge.edge.startIndex;
  const endIdx = endEdge.edge.startIndex;

  // New vertices at cut points
  const newVertex1 = startEdge.point.clone();
  const newVertex2 = endEdge.point.clone();

  // Interpolate UVs at cut points
  const newUV1 = new THREE.Vector2().lerpVectors(
    uvs[startIdx],
    uvs[(startIdx + 1) % n],
    startEdge.t
  );
  const newUV2 = new THREE.Vector2().lerpVectors(
    uvs[endIdx],
    uvs[(endIdx + 1) % n],
    endEdge.t
  );

  // Build two new faces by walking around the polygon
  // Face 1: from newVertex1 along edges to newVertex2
  // Face 2: from newVertex2 along remaining edges to newVertex1
  // Both faces maintain the same winding order as the original

  const face1Verts = [];
  const face1UVs = [];
  const face2Verts = [];
  const face2UVs = [];

  // Face 1: newVertex1 -> vertices from startEdge.endIndex to endEdge.startIndex -> newVertex2
  face1Verts.push(newVertex1.clone());
  face1UVs.push(newUV1.clone());

  for (let i = (startEdge.edge.endIndex) % n; ; i = (i + 1) % n) {
    face1Verts.push(vertices[i].clone());
    face1UVs.push(uvs[i].clone());
    if (i === endEdge.edge.startIndex) break;
    if (face1Verts.length > n + 2) break; // Safety
  }

  face1Verts.push(newVertex2.clone());
  face1UVs.push(newUV2.clone());

  // Face 2: newVertex2 -> vertices from endEdge.endIndex to startEdge.startIndex -> newVertex1
  face2Verts.push(newVertex2.clone());
  face2UVs.push(newUV2.clone());

  for (let i = (endEdge.edge.endIndex) % n; ; i = (i + 1) % n) {
    face2Verts.push(vertices[i].clone());
    face2UVs.push(uvs[i].clone());
    if (i === startEdge.edge.startIndex) break;
    if (face2Verts.length > n + 2) break; // Safety
  }

  face2Verts.push(newVertex1.clone());
  face2UVs.push(newUV1.clone());

  // Create new faces
  const newFace1 = new Face(face.id, face1Verts, face1UVs);
  const newFace2 = new Face(nextFaceId, face2Verts, face2UVs);

  return { face1: newFace1, face2: newFace2 };
}

/**
 * Find the intersection of an infinite line with an edge segment
 * @param {THREE.Vector3} linePoint1 - First point on the infinite line
 * @param {THREE.Vector3} linePoint2 - Second point on the infinite line
 * @param {THREE.Vector3} edgeStart - Start of edge segment
 * @param {THREE.Vector3} edgeEnd - End of edge segment
 * @returns {{point: THREE.Vector3, t: number}|null} - Intersection point and t parameter (0-1 along edge)
 */
function lineEdgeIntersection(linePoint1, linePoint2, edgeStart, edgeEnd) {
  // Work in 2D by projecting onto the dominant plane
  // Use XY plane for now (assumes faces are roughly in XY plane)
  const x1 = linePoint1.x, y1 = linePoint1.y;
  const x2 = linePoint2.x, y2 = linePoint2.y;
  const x3 = edgeStart.x, y3 = edgeStart.y;
  const x4 = edgeEnd.x, y4 = edgeEnd.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 0.0001) return null; // Parallel

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  // u must be in [0, 1] for intersection to be on the edge segment
  // t can be any value (infinite line)
  if (u < 0.001 || u > 0.999) return null; // Not on edge (with small margin)

  const point = new THREE.Vector3().lerpVectors(edgeStart, edgeEnd, u);
  return { point, t: u };
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

    const edges = face.getEdges();
    const intersections = [];

    // Find all edge intersections with the infinite line
    for (const edge of edges) {
      const intersection = lineEdgeIntersection(linePoint1, linePoint2, edge.start, edge.end);
      if (intersection) {
        intersections.push({
          edge: edge,
          point: intersection.point,
          t: intersection.t
        });
      }
    }

    // Need exactly 2 intersections for a valid cut
    if (intersections.length === 2) {
      // Make sure they're on different edges
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

      // Listen for pointerup on document since overlay won't receive it
      const onDocumentPointerUp = () => {
        this.isRotating = false;
        this.canvas.style.pointerEvents = 'auto';
        document.removeEventListener('pointerup', onDocumentPointerUp);
      };
      document.addEventListener('pointerup', onDocumentPointerUp);
      return;
    }

    // Disable rotation when interacting with mesh
    this.canvas.style.pointerEvents = 'auto';
    this.sceneManager.setControlsEnabled(false);
    this.isRotating = false;

    if (!this.startPoint) {
      // First click - set start
      this.startEdge = result.edge;
      this.startFace = result.face;
      this.startPoint = this.worldToScreen(result.edge.point);
    } else {
      // Second click - store pending cut if valid and signal ready
      // Compare by face ID (more robust than object reference)
      const sameFace = result.face.id === this.startFace.id;
      const differentEdge = result.edge.edge.startIndex !== this.startEdge.edge.startIndex;

      if (sameFace && differentEdge) {
        this.pendingCut = {
          face: this.startFace,
          startEdge: this.startEdge,
          endEdge: result.edge
        };
        if (this.onReady) {
          this.onReady(this.pendingCut);
        }
      } else {
        // Invalid cut - reset and allow user to try again
        this.reset();
      }
    }

    this.draw();
  }

  /**
   * Execute the pending cut
   */
  executePendingCut() {
    if (this.pendingCut && this.onCutComplete) {
      this.onCutComplete(this.pendingCut.face, this.pendingCut.startEdge, this.pendingCut.endEdge);
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
      this.hoverFace.id === this.startFace.id &&
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
