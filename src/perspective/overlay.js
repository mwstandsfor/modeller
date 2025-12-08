/**
 * 2D Overlay for drawing perspective correction lines
 * Uses fSpy-style 4-line approach with 2 vanishing points
 */
export class PerspectiveOverlay {
  constructor(canvas, sceneManager) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sceneManager = sceneManager;

    // Line data - 4 lines: 2 pairs for 2 vanishing points
    // x1, x2 define horizontal vanishing point (parallel horizontal lines in 3D)
    // y1, y2 define vertical vanishing point (parallel vertical lines in 3D)
    this.lines = {
      x1: null,
      x2: null,
      y1: null,
      y2: null
    };

    // Line order for drawing
    this.lineOrder = ['x1', 'x2', 'y1', 'y2'];
    this.currentLineIndex = 0;

    // Current line being drawn
    this.currentLine = null;

    // Selected line for redrawing
    this.selectedLine = null;

    // Drawing state
    this.isDrawing = false;
    this.startPoint = null;

    // Style
    this.colors = {
      x: '#ff6b6b', // Red for X-axis lines
      y: '#4ecdc4', // Teal for Y-axis lines
      guide: '#888888',
      selected: '#ffffff'
    };

    // Callbacks
    this.onComplete = null;
    this.onReady = null;

    this.handleResize = this.handleResize.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);

    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  /**
   * Activate the overlay for drawing
   */
  activate() {
    this.canvas.style.display = 'block';
    this.canvas.classList.add('active');

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointerleave', this.handlePointerUp);

    // Reset state
    this.lines = { x1: null, x2: null, y1: null, y2: null };
    this.currentLineIndex = 0;
    this.selectedLine = null;
    this.isDrawing = false;

    this.draw();
  }

  /**
   * Deactivate the overlay
   */
  deactivate() {
    this.canvas.style.display = 'none';
    this.canvas.classList.remove('active');

    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerUp);
  }

  handleResize() {
    const container = this.canvas.parentElement;
    const rect = container.getBoundingClientRect();

    this.canvas.width = rect.width;
    this.canvas.height = rect.height;

    this.draw();
  }

  /**
   * Check if a point is near a line
   */
  isPointNearLine(point, line, threshold = 20) {
    if (!line) return false;

    const { start, end } = line;

    // Calculate distance from point to line segment
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length < 1) return false;

    // Project point onto line
    const t = Math.max(0, Math.min(1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / (length * length)
    ));

    const projX = start.x + t * dx;
    const projY = start.y + t * dy;

    const distance = Math.sqrt(
      (point.x - projX) ** 2 + (point.y - projY) ** 2
    );

    return distance < threshold;
  }

  /**
   * Find which line is near the point
   */
  findLineAtPoint(point) {
    for (const key of this.lineOrder) {
      if (this.isPointNearLine(point, this.lines[key])) {
        return key;
      }
    }
    return null;
  }

  handlePointerDown(e) {
    e.preventDefault();
    const point = this.getPoint(e);

    // Check if clicking on an existing line to redraw it
    const clickedLine = this.findLineAtPoint(point);

    if (clickedLine && !this.isDrawing) {
      // Select this line for redrawing
      this.selectedLine = clickedLine;
      this.isDrawing = true;
      this.startPoint = point;
      this.currentLine = { start: point, end: point };
      this.draw();
      return;
    }

    // Otherwise, draw the next line in sequence
    if (this.currentLineIndex < 4) {
      this.selectedLine = null;
      this.isDrawing = true;
      this.startPoint = point;
      this.currentLine = { start: point, end: point };
      this.draw();
    }
  }

  handlePointerMove(e) {
    if (!this.isDrawing || !this.startPoint) return;

    const point = this.getPoint(e);
    this.currentLine = { start: this.startPoint, end: point };
    this.draw();
  }

  handlePointerUp(e) {
    if (!this.isDrawing || !this.currentLine) return;

    this.isDrawing = false;

    // Check if line is long enough (minimum 50 pixels)
    const dx = this.currentLine.end.x - this.currentLine.start.x;
    const dy = this.currentLine.end.y - this.currentLine.start.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length >= 50) {
      if (this.selectedLine) {
        // Redrawing an existing line
        this.lines[this.selectedLine] = { ...this.currentLine };
        this.selectedLine = null;
      } else {
        // Drawing a new line in sequence
        const key = this.lineOrder[this.currentLineIndex];
        this.lines[key] = { ...this.currentLine };
        this.currentLineIndex++;
      }

      // Check if all 4 lines are drawn
      if (this.allLinesDrawn()) {
        if (this.onReady) {
          this.onReady(this.lines);
        }
      }
    }

    this.currentLine = null;
    this.startPoint = null;
    this.draw();
  }

  /**
   * Check if all 4 lines are drawn
   */
  allLinesDrawn() {
    return this.lines.x1 && this.lines.x2 && this.lines.y1 && this.lines.y2;
  }

  getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  /**
   * Get which line type we're currently drawing
   */
  getCurrentLineType() {
    if (this.selectedLine) {
      return this.selectedLine.startsWith('x') ? 'x' : 'y';
    }
    if (this.currentLineIndex < 4) {
      return this.lineOrder[this.currentLineIndex].startsWith('x') ? 'x' : 'y';
    }
    return 'x';
  }

  /**
   * Draw the overlay
   */
  draw() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, width, height);

    // Draw center guides
    ctx.strokeStyle = this.colors.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    // Vertical center
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();

    // Horizontal center
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ctx.setLineDash([]);

    // Draw vanishing point lines if both X lines exist
    if (this.lines.x1 && this.lines.x2) {
      this.drawVanishingPointLines(this.lines.x1, this.lines.x2, this.colors.x);
    }

    // Draw vanishing point lines if both Y lines exist
    if (this.lines.y1 && this.lines.y2) {
      this.drawVanishingPointLines(this.lines.y1, this.lines.y2, this.colors.y);
    }

    // Draw saved lines with selection state
    const activeLineType = this.getCurrentLineType();

    for (const key of this.lineOrder) {
      if (this.lines[key]) {
        const isXType = key.startsWith('x');
        const baseColor = isXType ? this.colors.x : this.colors.y;
        const isSelected = key === this.selectedLine;
        const isActiveType = (isXType && activeLineType === 'x') || (!isXType && activeLineType === 'y');

        // Dim lines that are not the active type (30% opacity)
        const opacity = isSelected ? 1.0 : (isActiveType ? 1.0 : 0.3);
        const label = key.toUpperCase().replace('1', '-1').replace('2', '-2');

        this.drawLine(this.lines[key], baseColor, label, opacity, isSelected);
      }
    }

    // Draw current line being drawn
    if (this.currentLine) {
      const color = this.getCurrentLineType() === 'x' ? this.colors.x : this.colors.y;
      this.drawLine(this.currentLine, color, null, 1.0, true);
    }
  }

  /**
   * Draw vanishing point extension lines
   */
  drawVanishingPointLines(line1, line2, color) {
    const ctx = this.ctx;

    // Calculate vanishing point (intersection of the two lines extended)
    const vp = this.lineIntersection(line1, line2);

    if (vp) {
      // Draw thin extension lines to vanishing point
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.setLineDash([4, 4]);

      // Extend line 1 to VP
      ctx.beginPath();
      ctx.moveTo(line1.end.x, line1.end.y);
      ctx.lineTo(vp.x, vp.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(line2.end.x, line2.end.y);
      ctx.lineTo(vp.x, vp.y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;

      // Draw vanishing point indicator
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(vp.x, vp.y, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(vp.x, vp.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Calculate line intersection
   */
  lineIntersection(line1, line2) {
    const x1 = line1.start.x, y1 = line1.start.y;
    const x2 = line1.end.x, y2 = line1.end.y;
    const x3 = line2.start.x, y3 = line2.start.y;
    const x4 = line2.end.x, y4 = line2.end.y;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

    if (Math.abs(denom) < 0.0001) {
      return null; // Parallel lines
    }

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1)
    };
  }

  /**
   * Draw a line with endpoints
   */
  drawLine(line, color, label = null, opacity = 1.0, isSelected = false) {
    const ctx = this.ctx;

    ctx.globalAlpha = opacity;

    // Line
    ctx.strokeStyle = isSelected ? this.colors.selected : color;
    ctx.lineWidth = isSelected ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(line.start.x, line.start.y);
    ctx.lineTo(line.end.x, line.end.y);
    ctx.stroke();

    // Endpoints
    ctx.fillStyle = isSelected ? this.colors.selected : color;
    ctx.beginPath();
    ctx.arc(line.start.x, line.start.y, isSelected ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(line.end.x, line.end.y, isSelected ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();

    // Label
    if (label) {
      const midX = (line.start.x + line.end.x) / 2;
      const midY = (line.start.y + line.end.y) / 2;

      ctx.fillStyle = isSelected ? this.colors.selected : color;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, midX, midY - 12);
    }

    ctx.globalAlpha = 1.0;
  }

  /**
   * Get the drawn lines
   */
  getLines() {
    return this.lines;
  }

  /**
   * Reset the overlay
   */
  reset() {
    this.lines = { x1: null, x2: null, y1: null, y2: null };
    this.currentLineIndex = 0;
    this.selectedLine = null;
    this.currentLine = null;
    this.startPoint = null;
    this.isDrawing = false;
    this.draw();
  }

  /**
   * Dispose of resources
   */
  dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.deactivate();
  }
}
