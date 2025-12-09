/**
 * Perspective Rectification using Vanishing Points
 *
 * This implements proper "Guided Upright" / metric rectification:
 *
 * INPUT: User draws 4 axis lines (NOT corners)
 * - 2 lines along horizontal edges → intersect at vanishing point Vx
 * - 2 lines along vertical edges → intersect at vanishing point Vy
 *
 * ALGORITHM:
 * 1. Compute vanishing points Vx and Vy from line intersections
 * 2. Compute the "horizon line" (line at infinity) from Vx and Vy
 * 3. Build rectifying homography that maps horizon to infinity
 * 4. Apply similarity transform to make axes orthogonal
 * 5. Warp entire image using the homography
 */

/**
 * Calculate intersection of two lines (each defined by two points)
 * Returns point in homogeneous coordinates (x, y, w)
 */
function lineIntersectionHomogeneous(line1, line2) {
  // Convert line endpoints to homogeneous line coefficients
  // Line through (x1,y1) and (x2,y2) has coefficients (y1-y2, x2-x1, x1*y2-x2*y1)
  const l1 = lineToCoeffs(line1);
  const l2 = lineToCoeffs(line2);

  // Intersection is cross product of line coefficients
  const x = l1[1] * l2[2] - l1[2] * l2[1];
  const y = l1[2] * l2[0] - l1[0] * l2[2];
  const w = l1[0] * l2[1] - l1[1] * l2[0];

  return { x, y, w };
}

/**
 * Convert a line (two points) to homogeneous line coefficients (a, b, c)
 * where ax + by + c = 0
 */
function lineToCoeffs(line) {
  const x1 = line.start.x, y1 = line.start.y;
  const x2 = line.end.x, y2 = line.end.y;
  return [y1 - y2, x2 - x1, x1 * y2 - x2 * y1];
}

/**
 * Cross product of two points in homogeneous coordinates
 * Returns line coefficients (a, b, c)
 */
function crossProduct(p1, p2) {
  return [
    p1.y * p2.w - p1.w * p2.y,
    p1.w * p2.x - p1.x * p2.w,
    p1.x * p2.y - p1.y * p2.x
  ];
}

/**
 * Multiply 3x3 matrix by 3x1 vector
 */
function matVecMult(M, v) {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]
  ];
}

/**
 * Multiply two 3x3 matrices
 */
function matMult(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        C[i][j] += A[i][k] * B[k][j];
      }
    }
  }
  return C;
}

/**
 * Invert a 3x3 matrix
 */
function invertMatrix3x3(M) {
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);

  if (Math.abs(det) < 1e-10) return null;

  const invDet = 1 / det;

  return [
    [
      (M[1][1] * M[2][2] - M[1][2] * M[2][1]) * invDet,
      (M[0][2] * M[2][1] - M[0][1] * M[2][2]) * invDet,
      (M[0][1] * M[1][2] - M[0][2] * M[1][1]) * invDet
    ],
    [
      (M[1][2] * M[2][0] - M[1][0] * M[2][2]) * invDet,
      (M[0][0] * M[2][2] - M[0][2] * M[2][0]) * invDet,
      (M[0][2] * M[1][0] - M[0][0] * M[1][2]) * invDet
    ],
    [
      (M[1][0] * M[2][1] - M[1][1] * M[2][0]) * invDet,
      (M[0][1] * M[2][0] - M[0][0] * M[2][1]) * invDet,
      (M[0][0] * M[1][1] - M[0][1] * M[1][0]) * invDet
    ]
  ];
}

/**
 * Apply homography to a point (x, y) -> (x', y')
 */
function applyHomography(H, x, y) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  if (Math.abs(w) < 1e-10) return null;
  return {
    x: (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    y: (H[1][0] * x + H[1][1] * y + H[1][2]) / w
  };
}

/**
 * Get the angle of a line
 */
export function lineAngle(line) {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  return Math.atan2(dy, dx);
}

/**
 * Main perspective transform function
 *
 * @param {object} lines - Object with x1, x2 (horizontal), y1, y2 (vertical) lines
 * @param {HTMLImageElement} img - Source image
 * @param {number} canvasWidth - Canvas width where lines were drawn
 * @param {number} canvasHeight - Canvas height where lines were drawn
 */
export async function perspectiveTransform(lines, img, canvasWidth, canvasHeight) {
  // Scale line coordinates to image space
  const scaleX = img.width / canvasWidth;
  const scaleY = img.height / canvasHeight;

  const scaleLine = (line) => ({
    start: { x: line.start.x * scaleX, y: line.start.y * scaleY },
    end: { x: line.end.x * scaleX, y: line.end.y * scaleY }
  });

  const x1 = scaleLine(lines.x1);
  const x2 = scaleLine(lines.x2);
  const y1 = scaleLine(lines.y1);
  const y2 = scaleLine(lines.y2);

  // Step 1: Compute vanishing points
  // Vx = intersection of horizontal lines (x1, x2)
  // Vy = intersection of vertical lines (y1, y2)
  const Vx = lineIntersectionHomogeneous(x1, x2);
  const Vy = lineIntersectionHomogeneous(y1, y2);

  console.log('Vanishing point Vx (homogeneous):', Vx);
  console.log('Vanishing point Vy (homogeneous):', Vy);

  // Check for degenerate cases (parallel lines)
  const vxFinite = Math.abs(Vx.w) > 1e-6;
  const vyFinite = Math.abs(Vy.w) > 1e-6;

  if (!vxFinite && !vyFinite) {
    console.log('Both vanishing points at infinity - no perspective correction needed');
    return fallbackCorrection(img);
  }

  // Normalize to get actual coordinates (if finite)
  const vx = vxFinite ? { x: Vx.x / Vx.w, y: Vx.y / Vx.w } : null;
  const vy = vyFinite ? { x: Vy.x / Vy.w, y: Vy.y / Vy.w } : null;

  console.log('Vanishing point Vx (Euclidean):', vx);
  console.log('Vanishing point Vy (Euclidean):', vy);

  // Step 2: Compute the horizon line (line at infinity of the scene plane)
  // This is the line passing through both vanishing points
  // In homogeneous coords: l = Vx × Vy
  const horizon = crossProduct(Vx, Vy);

  // Normalize the horizon line coefficients
  const horizonNorm = Math.sqrt(horizon[0] * horizon[0] + horizon[1] * horizon[1]);
  if (horizonNorm < 1e-10) {
    console.log('Degenerate horizon line');
    return fallbackCorrection(img);
  }

  // Horizon line: l = (l1, l2, l3) where l1*x + l2*y + l3 = 0
  const l1 = horizon[0] / horizon[2];
  const l2 = horizon[1] / horizon[2];

  console.log('Horizon line coefficients (normalized):', l1, l2);

  // Step 3: Build the affine rectification homography
  // Ha maps the horizon line to the line at infinity
  // Ha = [[1, 0, 0], [0, 1, 0], [l1, l2, 1]]
  const Ha = [
    [1, 0, 0],
    [0, 1, 0],
    [l1, l2, 1]
  ];

  console.log('Affine rectification matrix Ha:', Ha);

  // Step 4: After affine rectification, we need to rotate/scale to make
  // the axes truly horizontal and vertical
  //
  // Transform the vanishing point directions through Ha to get
  // the rectified directions, then compute rotation to align them

  // Direction from image center to Vx (before rectification)
  const imgCenterX = img.width / 2;
  const imgCenterY = img.height / 2;

  // Get average direction of horizontal lines
  const hAngle1 = lineAngle(x1);
  const hAngle2 = lineAngle(x2);
  let avgHAngle = (hAngle1 + hAngle2) / 2;

  // Get average direction of vertical lines
  const vAngle1 = lineAngle(y1);
  const vAngle2 = lineAngle(y2);
  let avgVAngle = (vAngle1 + vAngle2) / 2;

  console.log('Average horizontal angle:', avgHAngle * 180 / Math.PI, 'degrees');
  console.log('Average vertical angle:', avgVAngle * 180 / Math.PI, 'degrees');

  // After affine rectification, the horizontal lines should become parallel
  // but may not be perfectly horizontal. We need a rotation.

  // Transform a horizontal direction vector through Ha
  // A point at (cx + cos(hAngle), cy + sin(hAngle)) maps to...
  const testPt1 = applyHomography(Ha, imgCenterX, imgCenterY);
  const testPt2 = applyHomography(Ha, imgCenterX + Math.cos(avgHAngle) * 100, imgCenterY + Math.sin(avgHAngle) * 100);

  if (!testPt1 || !testPt2) {
    console.log('Failed to transform test points');
    return fallbackCorrection(img);
  }

  // Direction after affine rectification
  const rectifiedHAngle = Math.atan2(testPt2.y - testPt1.y, testPt2.x - testPt1.x);
  console.log('Rectified horizontal angle:', rectifiedHAngle * 180 / Math.PI, 'degrees');

  // Rotation needed to make horizontal lines truly horizontal
  const rotationAngle = -rectifiedHAngle;

  // Build rotation matrix (around origin)
  const cos = Math.cos(rotationAngle);
  const sin = Math.sin(rotationAngle);
  const Hr = [
    [cos, -sin, 0],
    [sin, cos, 0],
    [0, 0, 1]
  ];

  // Combined homography: H = Hr * Ha
  // But we also need to handle translation to keep the image centered
  const H_noTranslate = matMult(Hr, Ha);

  // Step 5: Compute output bounds by transforming image corners
  const corners = [
    { x: 0, y: 0 },
    { x: img.width, y: 0 },
    { x: img.width, y: img.height },
    { x: 0, y: img.height }
  ];

  const transformedCorners = [];
  for (const c of corners) {
    const tc = applyHomography(H_noTranslate, c.x, c.y);
    if (!tc) {
      console.log('Failed to transform corner');
      return fallbackCorrection(img);
    }
    transformedCorners.push(tc);
  }

  // Find bounding box
  const xs = transformedCorners.map(c => c.x);
  const ys = transformedCorners.map(c => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  console.log('Output bounds:', minX, minY, maxX, maxY);

  // Add translation to shift output to positive coordinates
  const Ht = [
    [1, 0, -minX],
    [0, 1, -minY],
    [0, 0, 1]
  ];

  // Final homography: H = Ht * Hr * Ha
  const H = matMult(Ht, H_noTranslate);

  console.log('Final homography H:', H);

  // Output dimensions
  let outWidth = Math.ceil(maxX - minX);
  let outHeight = Math.ceil(maxY - minY);

  // Limit size to prevent memory issues
  const maxDim = 4096;
  let scale = 1;
  if (outWidth > maxDim || outHeight > maxDim) {
    scale = maxDim / Math.max(outWidth, outHeight);
    outWidth = Math.ceil(outWidth * scale);
    outHeight = Math.ceil(outHeight * scale);

    // Add scaling to the homography
    const Hs = [[scale, 0, 0], [0, scale, 0], [0, 0, 1]];
    const H_scaled = matMult(Hs, H);
    H[0] = H_scaled[0];
    H[1] = H_scaled[1];
    H[2] = H_scaled[2];
  }

  // Compute inverse homography for backward mapping
  const Hinv = invertMatrix3x3(H);
  if (!Hinv) {
    console.log('Failed to invert homography');
    return fallbackCorrection(img);
  }

  // Step 6: Warp the image
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');

  // Get source image data
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, img.width, img.height);

  // Create output image data
  const imageData = ctx.createImageData(outWidth, outHeight);

  // Backward mapping with bilinear interpolation
  for (let outY = 0; outY < outHeight; outY++) {
    for (let outX = 0; outX < outWidth; outX++) {
      // Map output pixel to source using inverse homography
      const srcPt = applyHomography(Hinv, outX, outY);

      if (!srcPt) continue;

      const sx = srcPt.x;
      const sy = srcPt.y;

      // Bilinear interpolation
      if (sx >= 0 && sx < img.width - 1 && sy >= 0 && sy < img.height - 1) {
        const sx0 = Math.floor(sx);
        const sy0 = Math.floor(sy);
        const fx = sx - sx0;
        const fy = sy - sy0;

        const idx = (outY * outWidth + outX) * 4;

        for (let c = 0; c < 4; c++) {
          const i00 = (sy0 * img.width + sx0) * 4 + c;
          const i10 = (sy0 * img.width + sx0 + 1) * 4 + c;
          const i01 = ((sy0 + 1) * img.width + sx0) * 4 + c;
          const i11 = ((sy0 + 1) * img.width + sx0 + 1) * 4 + c;

          const v = srcData.data[i00] * (1 - fx) * (1 - fy) +
                   srcData.data[i10] * fx * (1 - fy) +
                   srcData.data[i01] * (1 - fx) * fy +
                   srcData.data[i11] * fx * fy;

          imageData.data[idx + c] = Math.round(v);
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return {
    canvas,
    width: outWidth,
    height: outHeight
  };
}

/**
 * Fallback - return image unchanged
 */
function fallbackCorrection(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  return {
    canvas,
    width: canvas.width,
    height: canvas.height
  };
}

/**
 * Legacy exports for compatibility
 */
export function lineIntersection(line1, line2) {
  const result = lineIntersectionHomogeneous(line1, line2);
  if (Math.abs(result.w) < 1e-10) return null;
  return { x: result.x / result.w, y: result.y / result.w };
}

export function calculateCorrection(xLine, yLine, imageWidth, imageHeight) {
  const xAngle = lineAngle(xLine);
  const yAngle = lineAngle(yLine);
  return {
    xAngle,
    yAngle,
    xDeviation: xAngle,
    yDeviation: yAngle - (-Math.PI / 2),
    rotation: -xAngle
  };
}
