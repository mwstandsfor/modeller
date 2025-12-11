import * as THREE from 'three';

/**
 * UTILITY: Find closest point on a segment
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
  t = Math.max(0, Math.min(len, t));

  const closest = new THREE.Vector3().copy(lineStart).add(line.multiplyScalar(t));

  return {
    point: closest,
    t: t / len,
    distance: point.distanceTo(closest)
  };
}

/**
 * UTILITY: Find closest edge to a point
 */
export function findClosestEdge(point, face, threshold = 0.1) {
  const edges = face.getEdges();
  let closest = null;
  let minDistance = threshold;

  for (const edge of edges) {
    const result = closestPointOnSegment(point, edge.start, edge.end);
    if (result.distance < minDistance) {
      minDistance = result.distance;
      closest = { edge, point: result.point, t: result.t };
    }
  }
  return closest;
}

/**
 * CORE LOGIC: Get face normal
 */
function getFaceNormal(face) {
  const vA = face.vertices[0];
  const vB = face.vertices[1];
  const vC = face.vertices[2];
  const cb = new THREE.Vector3().subVectors(vC, vB);
  const ab = new THREE.Vector3().subVectors(vA, vB);
  return cb.cross(ab).normalize();
}

/**
 * CORE LOGIC: 3D Line-Edge Intersection
 * Projects to the dominant axis to handle walls/slopes correctly
 */
function lineEdgeIntersection(linePoint1, linePoint2, edgeStart, edgeEnd, faceNormal) {
  let u = 'x', v = 'y';
  const nx = Math.abs(faceNormal.x);
  const ny = Math.abs(faceNormal.y);
  const nz = Math.abs(faceNormal.z);

  if (nx > ny && nx > nz) { u = 'y'; v = 'z'; }
  else if (ny > nx && ny > nz) { u = 'x'; v = 'z'; }
  else { u = 'x'; v = 'y'; }

  const a1 = linePoint1[u], b1 = linePoint1[v];
  const a2 = linePoint2[u], b2 = linePoint2[v];
  const a3 = edgeStart[u], b3 = edgeStart[v];
  const a4 = edgeEnd[u], b4 = edgeEnd[v];

  const denom = (a1 - a2) * (b3 - b4) - (b1 - b2) * (a3 - a4);
  if (Math.abs(denom) < 0.00001) return null;

  const mu = -((a1 - a2) * (b1 - b3) - (b1 - b2) * (a1 - a3)) / denom;

  if (mu < 0.001 || mu > 0.999) return null;

  const point = new THREE.Vector3().lerpVectors(edgeStart, edgeEnd, mu);
  return { point, t: mu };
}

/**
 * CORE LOGIC: Find all faces crossed by an infinite line
 */
export function findFacesOnLine(faces, linePoint1, linePoint2, excludeFace = null) {
  const results = [];

  for (const face of faces) {
    if (excludeFace && face.id === excludeFace.id) continue;

    const normal = getFaceNormal(face);
    const edges = face.getEdges();
    const intersections = [];

    for (const edge of edges) {
      const intersection = lineEdgeIntersection(linePoint1, linePoint2, edge.start, edge.end, normal);
      if (intersection) {
        intersections.push({
          edge: edge,
          point: intersection.point,
          t: intersection.t
        });
      }
    }

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
 * CORE LOGIC: Split a single face
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

    const newVertex1 = new THREE.Vector3().copy(startEdge.point);
    const newVertex2 = new THREE.Vector3().copy(endEdge.point);

    const startUV = uvs[startIdx] || new THREE.Vector2();
    const startNextUV = uvs[(startIdx + 1) % n] || new THREE.Vector2();
    const newUV1 = new THREE.Vector2().lerpVectors(startUV, startNextUV, startEdge.t);

    const endUV = uvs[endIdx] || new THREE.Vector2();
    const endNextUV = uvs[(endIdx + 1) % n] || new THREE.Vector2();
    const newUV2 = new THREE.Vector2().lerpVectors(endUV, endNextUV, endEdge.t);

    const face1Verts = [], face1UVs = [];
    const face2Verts = [], face2UVs = [];

    face1Verts.push(newVertex1.clone());
    face1UVs.push(newUV1.clone());

    let i = (startEdge.edge.endIndex) % n;
    let safety = 0;
    while(true) {
        face1Verts.push(vertices[i].clone());
        face1UVs.push(uvs[i].clone());
        if (i === endEdge.edge.startIndex) break;
        i = (i + 1) % n;
        if (safety++ > n * 2) break; 
    }

    face1Verts.push(newVertex2.clone());
    face1UVs.push(newUV2.clone());

    face2Verts.push(newVertex2.clone());
    face2UVs.push(newUV2.clone());

    i = (endEdge.edge.endIndex) % n;
    safety = 0;
    while(true) {
        face2Verts.push(vertices[i].clone());
        face2UVs.push(uvs[i].clone());
        if (i === startEdge.edge.startIndex) break;
        i = (i + 1) % n;
        if (safety++ > n * 2) break;
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
 * NEW: Slice Mesh Logic (Handles Quads/Multiple Triangles)
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