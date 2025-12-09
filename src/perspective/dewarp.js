/**
 * Perspective Rectification using Vanishing Points
 *
 * INPUT: User draws 4 axis lines (NOT corners)
 * - 2 lines along horizontal edges → intersect at vanishing point Vx
 * - 2 lines along vertical edges → intersect at vanishing point Vy
 *
 * ALGORITHM:
 * 1. Compute vanishing points Vx and Vy from line intersections
 * 2. Compute the "horizon line" from Vx and Vy
 * 3. Build rectifying homography that maps horizon to infinity
 * 4. Apply similarity transform to make axes orthogonal
 * 5. Warp entire image using the homography
 */

/**
 * Calculate intersection of two lines (each defined by two points)
 * Returns point in homogeneous coordinates (x, y, w)
 */
function lineIntersectionHomogeneous(line1, line2) {
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
 * Normalize a line so it points in a consistent direction
 * For horizontal lines: point generally to the right (angle between -PI/2 and PI/2)
 * For vertical lines: point generally upward (angle between -PI and 0)
 */
function normalizeLine(line, isVertical = false) {
  const angle = lineAngle(line);

  if (isVertical) {
    // Vertical lines should point upward (negative y direction)
    // Angle should be between -PI and 0 (pointing up-left to up-right)
    if (angle > 0) {
      // Flip the line
      return { start: line.end, end: line.start };
    }
  } else {
    // Horizontal lines should point right
    // Angle should be between -PI/2 and PI/2
    if (Math.abs(angle) > Math.PI / 2) {
      // Flip the line
      return { start: line.end, end: line.start };
    }
  }
  return line;
}

/**
 * Main perspective transform function
 */
export async function perspectiveTransform(lines, img, canvasWidth, canvasHeight) {
  // Scale line coordinates to image space
  const scaleX = img.width / canvasWidth;
  const scaleY = img.height / canvasHeight;

  const scaleLine = (line) => ({
    start: { x: line.start.x * scaleX, y: line.start.y * scaleY },
    end: { x: line.end.x * scaleX, y: line.end.y * scaleY }
  });

  // Scale and normalize lines for consistent direction
  // This ensures the algorithm is independent of how lines were drawn
  const x1Raw = scaleLine(lines.x1);
  const x2Raw = scaleLine(lines.x2);
  const y1Raw = scaleLine(lines.y1);
  const y2Raw = scaleLine(lines.y2);

  // Normalize line directions
  const x1 = normalizeLine(x1Raw, false);  // Horizontal, point right
  const x2 = normalizeLine(x2Raw, false);
  const y1 = normalizeLine(y1Raw, true);   // Vertical, point up
  const y2 = normalizeLine(y2Raw, true);

  const imgCenterX = img.width / 2;
  const imgCenterY = img.height / 2;

  // Step 1: Compute vanishing points
  // Note: VP computation is independent of line direction
  const Vx = lineIntersectionHomogeneous(x1, x2); // Horizontal VP
  const Vy = lineIntersectionHomogeneous(y1, y2); // Vertical VP

  console.log('Vanishing point Vx (homogeneous):', Vx);
  console.log('Vanishing point Vy (homogeneous):', Vy);

  // Check for degenerate cases
  const vxFinite = Math.abs(Vx.w) > 1e-6;
  const vyFinite = Math.abs(Vy.w) > 1e-6;

  // Get Euclidean coordinates if finite
  const vx = vxFinite ? { x: Vx.x / Vx.w, y: Vx.y / Vx.w } : null;
  const vy = vyFinite ? { x: Vy.x / Vy.w, y: Vy.y / Vy.w } : null;

  console.log('Vanishing point Vx (Euclidean):', vx);
  console.log('Vanishing point Vy (Euclidean):', vy);

  // Get line angles for rotation calculation (now using normalized lines)
  const hAngle1 = lineAngle(x1);
  const hAngle2 = lineAngle(x2);
  const avgHAngle = (hAngle1 + hAngle2) / 2;

  const vAngle1 = lineAngle(y1);
  const vAngle2 = lineAngle(y2);
  const avgVAngle = (vAngle1 + vAngle2) / 2;

  console.log('Normalized line angles:');
  console.log('  X1:', hAngle1 * 180 / Math.PI, 'X2:', hAngle2 * 180 / Math.PI);
  console.log('  Y1:', vAngle1 * 180 / Math.PI, 'Y2:', vAngle2 * 180 / Math.PI);
  console.log('Average horizontal angle:', avgHAngle * 180 / Math.PI, 'degrees');
  console.log('Average vertical angle:', avgVAngle * 180 / Math.PI, 'degrees');

  // Step 2: Build the affine rectification homography
  // The horizon line passes through both vanishing points
  // We use the normalized form for stability

  let Ha;

  if (vxFinite && vyFinite) {
    // Both vanishing points are finite - compute horizon line
    // Horizon line: l = (l1, l2, l3) passes through Vx and Vy
    // l1*(x) + l2*(y) + l3 = 0

    // Direction from Vx to Vy
    const dx = vy.x - vx.x;
    const dy = vy.y - vx.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < 1e-6) {
      console.log('Vanishing points too close');
      return fallbackCorrection(img);
    }

    // Line through Vx and Vy: normal is perpendicular to direction
    // l1 = dy/len, l2 = -dx/len (normalized normal)
    // l3 = -(l1*vx.x + l2*vx.y)
    const l1 = dy / len;
    const l2 = -dx / len;
    const l3 = -(l1 * vx.x + l2 * vx.y);

    console.log('Horizon line (l1, l2, l3):', l1, l2, l3);

    // The affine rectification homography maps horizon line to line at infinity
    // Ha = [[1, 0, 0], [0, 1, 0], [l1/l3, l2/l3, 1]] when l3 != 0
    // But we need to be careful about the sign and magnitude

    // Scale factor to prevent extreme distortion
    // The idea: l1*x + l2*y + l3 = 0 defines the horizon
    // At image center: value = l1*cx + l2*cy + l3
    const centerValue = l1 * imgCenterX + l2 * imgCenterY + l3;
    console.log('Horizon line value at image center:', centerValue);

    // The correction strength should be proportional to how far the horizon is
    // A far horizon (large |l3|) means less distortion needed
    // We normalize by the distance from the image center to the horizon line

    if (Math.abs(l3) < 1e-6) {
      // Horizon passes through origin - use a different approach
      Ha = [
        [1, 0, 0],
        [0, 1, 0],
        [l1 / 1000, l2 / 1000, 1]  // Small correction
      ];
    } else {
      // Standard case: normalize by l3
      // The sign of l3 determines direction of correction
      // We want points on the "near" side (same side as image center) to expand less

      // Ensure consistent direction: if horizon is above image center, l3 should be positive
      // (so that the correction expands the top and contracts the bottom)
      let sign = Math.sign(centerValue);
      if (sign === 0) sign = 1;

      const correctionScale = sign / Math.abs(l3);

      Ha = [
        [1, 0, 0],
        [0, 1, 0],
        [l1 * correctionScale, l2 * correctionScale, 1]
      ];
    }
  } else if (vyFinite) {
    // Only vertical VP is finite - just do vertical keystone
    // This means horizontal lines are already parallel
    const distY = vy.y - imgCenterY;
    const distX = vy.x - imgCenterX;
    const dist = Math.sqrt(distX * distX + distY * distY);

    if (dist < 100) {
      console.log('Vertical VP too close to image center');
      return fallbackCorrection(img);
    }

    // Keystone correction based on VP position
    // The further the VP, the less correction needed
    const strength = 1 / dist;

    Ha = [
      [1, 0, 0],
      [0, 1, 0],
      [distX * strength * 0.001, distY * strength * 0.001, 1]
    ];
  } else if (vxFinite) {
    // Only horizontal VP is finite - just do horizontal keystone
    const distY = vx.y - imgCenterY;
    const distX = vx.x - imgCenterX;
    const dist = Math.sqrt(distX * distX + distY * distY);

    if (dist < 100) {
      console.log('Horizontal VP too close to image center');
      return fallbackCorrection(img);
    }

    const strength = 1 / dist;

    Ha = [
      [1, 0, 0],
      [0, 1, 0],
      [distX * strength * 0.001, distY * strength * 0.001, 1]
    ];
  } else {
    // Both VPs at infinity - no perspective correction needed
    console.log('Both VPs at infinity - no perspective correction needed');
    Ha = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  }

  console.log('Affine rectification matrix Ha:', Ha);

  // Step 3: Compute rotation to make horizontal lines truly horizontal
  // Transform test points through Ha to see the rectified angle
  const testPt1 = applyHomography(Ha, imgCenterX, imgCenterY);
  const testPt2 = applyHomography(Ha, imgCenterX + Math.cos(avgHAngle) * 100, imgCenterY + Math.sin(avgHAngle) * 100);

  if (!testPt1 || !testPt2) {
    console.log('Failed to transform test points');
    return fallbackCorrection(img);
  }

  const rectifiedHAngle = Math.atan2(testPt2.y - testPt1.y, testPt2.x - testPt1.x);
  console.log('Rectified horizontal angle:', rectifiedHAngle * 180 / Math.PI, 'degrees');

  const rotationAngle = -rectifiedHAngle;

  const cos = Math.cos(rotationAngle);
  const sin = Math.sin(rotationAngle);
  const Hr = [
    [cos, -sin, 0],
    [sin, cos, 0],
    [0, 0, 1]
  ];

  // Combined homography (without translation)
  const H_noTranslate = matMult(Hr, Ha);

  // Step 4: Compute output bounds
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

  const xs = transformedCorners.map(c => c.x);
  const ys = transformedCorners.map(c => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  console.log('Output bounds:', minX, minY, 'to', maxX, maxY);

  // Check for extreme distortion
  const outWidth = maxX - minX;
  const outHeight = maxY - minY;
  const aspectRatio = outWidth / outHeight;
  const originalAspect = img.width / img.height;

  if (aspectRatio > originalAspect * 5 || aspectRatio < originalAspect / 5) {
    console.log('Extreme aspect ratio distortion detected, using fallback');
    return fallbackCorrection(img);
  }

  // Translation to shift output to positive coordinates
  const Ht = [
    [1, 0, -minX],
    [0, 1, -minY],
    [0, 0, 1]
  ];

  // Final homography
  let H = matMult(Ht, H_noTranslate);

  // Output dimensions with size limit
  let finalWidth = Math.ceil(outWidth);
  let finalHeight = Math.ceil(outHeight);

  const maxDim = 4096;
  let scale = 1;
  if (finalWidth > maxDim || finalHeight > maxDim) {
    scale = maxDim / Math.max(finalWidth, finalHeight);
    finalWidth = Math.ceil(finalWidth * scale);
    finalHeight = Math.ceil(finalHeight * scale);

    const Hs = [[scale, 0, 0], [0, scale, 0], [0, 0, 1]];
    H = matMult(Hs, H);
  }

  console.log('Final output size:', finalWidth, 'x', finalHeight);

  // Inverse homography for backward mapping
  const Hinv = invertMatrix3x3(H);
  if (!Hinv) {
    console.log('Failed to invert homography');
    return fallbackCorrection(img);
  }

  // Step 5: Warp the image
  const canvas = document.createElement('canvas');
  canvas.width = finalWidth;
  canvas.height = finalHeight;
  const ctx = canvas.getContext('2d');

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, img.width, img.height);

  const imageData = ctx.createImageData(finalWidth, finalHeight);

  for (let outY = 0; outY < finalHeight; outY++) {
    for (let outX = 0; outX < finalWidth; outX++) {
      const srcPt = applyHomography(Hinv, outX, outY);
      if (!srcPt) continue;

      const sx = srcPt.x;
      const sy = srcPt.y;

      if (sx >= 0 && sx < img.width - 1 && sy >= 0 && sy < img.height - 1) {
        const sx0 = Math.floor(sx);
        const sy0 = Math.floor(sy);
        const fx = sx - sx0;
        const fy = sy - sy0;

        const idx = (outY * finalWidth + outX) * 4;

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
    width: finalWidth,
    height: finalHeight
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
