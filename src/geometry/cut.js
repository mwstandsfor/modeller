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
  // Face 1: from newVertex1 along edges to newVertex2, then back to newVertex1
  // Face 2: the remaining vertices

  const face1Verts = [];
  const face1UVs = [];
  const face2Verts = [];
  const face2UVs = [];

  // Determine which direction to walk
  let idx1 = (startIdx + 1) % n;
  let idx2 = endIdx;

  // Make sure idx1 < idx2 for consistent ordering
  if (idx1 > idx2) {
    [idx1, idx2] = [idx2, idx1];
    [newVertex1.copy(newVertex2), newVertex2.copy(startEdge.point)];
    [newUV1.copy(newUV2), newUV2.copy(new THREE.Vector2().lerpVectors(
      uvs[startIdx],
      uvs[(startIdx + 1) % n],
      startEdge.t
    ))];
  }

  // Rebuild using the cut line
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
 * Cut overlay for drawing cut lines on the mesh
 */
export class CutOverlay {
  constructor(canvas, sceneManager) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sceneManager = sceneManager;

    this.startPoint = null; // Screen coordinates
    this.startEdge = null;  // 3D edge data
    this.currentPoint = null;
    this.isActive = false;

    // Style
    this.lineColor = '#ffcc00';

    // Callbacks
    this.onCutComplete = null;

    this.handleResize = this.handleResize.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);

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
  }

  handleResize() {
    const container = this.canvas.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;

    this.draw();
  }

  handlePointerDown(e) {
    const screenPoint = this.getPoint(e);

    // Raycast to find edge
    const ndc = this.sceneManager.screenToNDC(e.clientX, e.clientY);
    const raycaster = this.sceneManager.getRaycaster(ndc.x, ndc.y);

    if (!this.editableMesh || !this.editableMesh.mesh) return;

    const intersects = raycaster.intersectObject(this.editableMesh.mesh);

    if (intersects.length === 0) return;

    const hitPoint = intersects[0].point;

    // Find closest edge to hit point
    let closestEdge = null;
    let closestFace = null;

    for (const face of this.editableMesh.faces) {
      const edge = findClosestEdge(hitPoint, face, 0.15);
      if (edge && (!closestEdge || edge.point.distanceTo(hitPoint) < closestEdge.point.distanceTo(hitPoint))) {
        closestEdge = edge;
        closestFace = face;
      }
    }

    if (!closestEdge) return;

    if (!this.startPoint) {
      // First click - set start
      this.startPoint = screenPoint;
      this.startEdge = closestEdge;
      this.startFace = closestFace;
    } else {
      // Second click - complete cut
      if (closestFace === this.startFace) {
        // Same face - can cut
        if (this.onCutComplete) {
          this.onCutComplete(this.startFace, this.startEdge, closestEdge);
        }
      }
      this.reset();
    }

    this.draw();
  }

  handlePointerMove(e) {
    if (!this.startPoint) return;

    this.currentPoint = this.getPoint(e);
    this.draw();
  }

  handlePointerUp(e) {
    // Cut completes on pointerdown of second point
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
    this.currentPoint = null;
  }

  draw() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!this.isActive) return;

    // Draw instruction
    ctx.fillStyle = 'rgba(30, 30, 30, 0.8)';
    ctx.beginPath();
    ctx.roundRect(width / 2 - 150, 10, 300, 40, 6);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      this.startPoint ? 'Click another edge to cut' : 'Click an edge to start cut',
      width / 2,
      35
    );

    // Draw cut line if we have a start
    if (this.startPoint && this.currentPoint) {
      ctx.strokeStyle = this.lineColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);

      ctx.beginPath();
      ctx.moveTo(this.startPoint.x, this.startPoint.y);
      ctx.lineTo(this.currentPoint.x, this.currentPoint.y);
      ctx.stroke();

      ctx.setLineDash([]);

      // Start point marker
      ctx.fillStyle = this.lineColor;
      ctx.beginPath();
      ctx.arc(this.startPoint.x, this.startPoint.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.deactivate();
  }
}
