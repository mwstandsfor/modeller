/**
 * Perspective correction / dewarp utilities
 * Uses 4-line vanishing point approach (fSpy-style)
 */

/**
 * Calculate the intersection point of two lines
 * Each line is defined by two points: {start: {x, y}, end: {x, y}}
 * @returns {{x: number, y: number}|null} - Intersection point or null if parallel
 */
export function lineIntersection(line1, line2) {
  const x1 = line1.start.x, y1 = line1.start.y;
  const x2 = line1.end.x, y2 = line1.end.y;
  const x3 = line2.start.x, y3 = line2.start.y;
  const x4 = line2.end.x, y4 = line2.end.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

  // Lines are parallel
  if (Math.abs(denom) < 0.0001) {
    return null;
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

  return {
    x: x1 + t * (x2 - x1),
    y: y1 + t * (y2 - y1)
  };
}

/**
 * Get the angle of a line in radians
 */
export function lineAngle(line) {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  return Math.atan2(dy, dx);
}

/**
 * Calculate the average angle of two lines
 */
function averageAngle(line1, line2) {
  const angle1 = lineAngle(line1);
  const angle2 = lineAngle(line2);

  // Handle angle wrapping
  let diff = angle2 - angle1;
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;

  return angle1 + diff / 2;
}

/**
 * Solve a 3x3 linear system using Gaussian elimination
 */
function solve3x3(A, b) {
  // Create augmented matrix
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]]
  ];

  // Forward elimination
  for (let col = 0; col < 3; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) {
        maxRow = row;
      }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    // Eliminate below
    for (let row = col + 1; row < 3; row++) {
      const factor = M[row][col] / M[col][col];
      for (let j = col; j < 4; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  // Back substitution
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    x[i] = M[i][3];
    for (let j = i + 1; j < 3; j++) {
      x[i] -= M[i][j] * x[j];
    }
    x[i] /= M[i][i];
  }

  return x;
}

/**
 * Calculate homography matrix from 4 point correspondences
 * srcPoints and dstPoints are arrays of 4 {x, y} points
 */
function calculateHomography(srcPoints, dstPoints) {
  // Build the system of equations
  const A = [];
  const b = [];

  for (let i = 0; i < 4; i++) {
    const sx = srcPoints[i].x;
    const sy = srcPoints[i].y;
    const dx = dstPoints[i].x;
    const dy = dstPoints[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  // Solve using least squares (pseudo-inverse)
  // For simplicity, use a basic solver
  const h = solveHomographySystem(A, b);

  // Return 3x3 matrix
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1]
  ];
}

/**
 * Solve the homography system using simple iterative approach
 */
function solveHomographySystem(A, b) {
  // This is a simplified solver - for 8 equations, 8 unknowns
  // Using normal equations: A^T * A * x = A^T * b
  const n = 8;
  const ATA = Array(n).fill(0).map(() => Array(n).fill(0));
  const ATb = Array(n).fill(0);

  // Compute A^T * A and A^T * b
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < 8; k++) {
        ATA[i][j] += A[k][i] * A[k][j];
      }
    }
    for (let k = 0; k < 8; k++) {
      ATb[i] += A[k][i] * b[k];
    }
  }

  // Solve using Gaussian elimination with partial pivoting
  return gaussianElimination(ATA, ATb);
}

/**
 * Gaussian elimination for NxN system
 */
function gaussianElimination(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  // Forward elimination
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) {
        maxRow = row;
      }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    if (Math.abs(M[col][col]) < 1e-10) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  // Back substitution
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= M[i][j] * x[j];
    }
    if (Math.abs(M[i][i]) > 1e-10) {
      x[i] /= M[i][i];
    }
  }

  return x;
}

/**
 * Apply homography to a point
 */
function applyHomography(H, point) {
  const x = point.x;
  const y = point.y;

  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  const px = (H[0][0] * x + H[0][1] * y + H[0][2]) / w;
  const py = (H[1][0] * x + H[1][1] * y + H[1][2]) / w;

  return { x: px, y: py };
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
 * Calculate perspective correction using 4 lines (2 vanishing points)
 *
 * @param {object} lines - Object with x1, x2, y1, y2 lines
 * @param {HTMLImageElement} img - Source image
 * @param {number} canvasWidth - Canvas width where lines were drawn
 * @param {number} canvasHeight - Canvas height where lines were drawn
 * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number}>}
 */
export async function perspectiveTransform(lines, img, canvasWidth, canvasHeight) {
  // Calculate vanishing points
  const vpX = lineIntersection(lines.x1, lines.x2);
  const vpY = lineIntersection(lines.y1, lines.y2);

  // Get average angles for X and Y directions
  const avgXAngle = averageAngle(lines.x1, lines.x2);
  const avgYAngle = averageAngle(lines.y1, lines.y2);

  // Calculate how much to rotate to make X horizontal
  const rotationAngle = -avgXAngle;

  // Calculate scale ratio between displayed canvas and actual image
  const scaleX = img.width / canvasWidth;
  const scaleY = img.height / canvasHeight;

  // Scale line coordinates to image space
  const scaleLine = (line) => ({
    start: { x: line.start.x * scaleX, y: line.start.y * scaleY },
    end: { x: line.end.x * scaleX, y: line.end.y * scaleY }
  });

  const x1Scaled = scaleLine(lines.x1);
  const x2Scaled = scaleLine(lines.x2);
  const y1Scaled = scaleLine(lines.y1);
  const y2Scaled = scaleLine(lines.y2);

  // Find the bounding quad from the 4 lines
  // We'll find the intersection of each X line with each Y line
  const corners = [
    lineIntersection(x1Scaled, y1Scaled),
    lineIntersection(x1Scaled, y2Scaled),
    lineIntersection(x2Scaled, y2Scaled),
    lineIntersection(x2Scaled, y1Scaled)
  ];

  // Check if we got valid intersections
  const validCorners = corners.every(c => c !== null);

  if (validCorners) {
    // Use homography to correct the perspective
    return applyHomographyCorrection(img, corners);
  } else {
    // Fallback to rotation-only correction
    return applyRotationCorrection(img, rotationAngle, avgXAngle, avgYAngle);
  }
}

/**
 * Apply homography-based perspective correction
 */
async function applyHomographyCorrection(img, corners) {
  // Find bounding box of corners
  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Target width and height (from quad dimensions)
  const width = maxX - minX;
  const height = maxY - minY;

  // Target rectangle corners
  const dstCorners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ];

  // Calculate homography from corners to rectangle
  const H = calculateHomography(corners, dstCorners);
  const Hinv = invertMatrix3x3(H);

  if (!Hinv) {
    // Fallback if inversion fails
    return fallbackCorrection(img);
  }

  // Create output canvas
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext('2d');

  // Apply inverse homography to sample from source image
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, img.width, img.height);

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      // Apply inverse homography to find source pixel
      const srcPoint = applyHomography(Hinv, { x, y });

      // Bilinear interpolation
      const sx = Math.floor(srcPoint.x);
      const sy = Math.floor(srcPoint.y);

      if (sx >= 0 && sx < img.width - 1 && sy >= 0 && sy < img.height - 1) {
        const fx = srcPoint.x - sx;
        const fy = srcPoint.y - sy;

        const idx = (y * canvas.width + x) * 4;

        for (let c = 0; c < 4; c++) {
          const i00 = (sy * img.width + sx) * 4 + c;
          const i10 = (sy * img.width + sx + 1) * 4 + c;
          const i01 = ((sy + 1) * img.width + sx) * 4 + c;
          const i11 = ((sy + 1) * img.width + sx + 1) * 4 + c;

          const v00 = srcData.data[i00];
          const v10 = srcData.data[i10];
          const v01 = srcData.data[i01];
          const v11 = srcData.data[i11];

          const v = v00 * (1 - fx) * (1 - fy) +
                   v10 * fx * (1 - fy) +
                   v01 * (1 - fx) * fy +
                   v11 * fx * fy;

          imageData.data[idx + c] = Math.round(v);
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return {
    canvas,
    width: canvas.width,
    height: canvas.height
  };
}

/**
 * Apply rotation-based correction (fallback)
 */
async function applyRotationCorrection(img, rotationAngle, xAngle, yAngle) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Calculate the angle between X and Y lines (should be 90 degrees)
  const angleBetween = Math.abs(yAngle - xAngle);
  const shearFactor = Math.tan(angleBetween - Math.PI / 2) * 0.3;

  // Calculate output size after rotation
  const cos = Math.abs(Math.cos(rotationAngle));
  const sin = Math.abs(Math.sin(rotationAngle));
  const newWidth = img.width * cos + img.height * sin;
  const newHeight = img.width * sin + img.height * cos;

  canvas.width = Math.ceil(newWidth);
  canvas.height = Math.ceil(newHeight);

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rotationAngle);

  // Apply slight shear to correct perspective
  ctx.transform(1, 0, shearFactor, 1, 0, 0);

  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  return {
    canvas,
    width: canvas.width,
    height: canvas.height
  };
}

/**
 * Simple fallback - just return the image as-is
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
 * Legacy function for backward compatibility
 */
export function calculateCorrection(xLine, yLine, imageWidth, imageHeight) {
  const xAngle = lineAngle(xLine);
  const yAngle = lineAngle(yLine);
  const xDeviation = xAngle;
  const yDeviation = yAngle - (-Math.PI / 2);
  const angleBetween = Math.abs(yAngle - xAngle);
  const angleFromPerpendicular = Math.abs(angleBetween - Math.PI / 2);

  return {
    xAngle,
    yAngle,
    xDeviation,
    yDeviation,
    angleFromPerpendicular,
    rotation: -xDeviation,
    shearX: Math.tan(yDeviation) * 0.5,
    shearY: 0,
    scaleX: 1,
    scaleY: 1 / Math.cos(angleFromPerpendicular * 0.5)
  };
}
