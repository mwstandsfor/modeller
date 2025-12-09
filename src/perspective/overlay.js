/**
 * 2D Overlay for drawing perspective correction rectangle
 * Uses 4-corner selection like imgRect.html
 */
export class PerspectiveOverlay {
  constructor(canvas, sceneManager) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sceneManager = sceneManager;

    // Corner points - array of {x, y}
    this.points = [];

    // Dragging state
    this.isDragging = false;
    this.dragIndex = -1;
    this.hoverIndex = -1;

    // Preview mode - when true, hide corner markers (preview is shown)
    this.previewMode = false;

    // Hit detection radius (scales with canvas)
    this.HIT_RADIUS = 20;

    // Style
    this.colors = {
      line: '#949DFF',       // Accent color for lines
      point: '#EA1941',      // Red for normal points
      pointHover: '#facc15', // Yellow for hover
      pointDrag: '#22c55e',  // Green for dragging
      guide: '#888888'
    };

    // Callbacks
    this.onComplete = null;  // Called when 4 points are placed
    this.onChange = null;    // Called when points change (for live preview)
    this.onReady = null;     // Alias for onComplete
    this.onExitPreview = null; // Called when user clicks to edit corners (exit preview mode)

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
    this.points = [];
    this.isDragging = false;
    this.dragIndex = -1;
    this.hoverIndex = -1;

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
   * Get canvas-relative point from event
   */
  getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  /**
   * Find which point is at the given position
   * Returns index or -1 if none
   */
  getPointAt(pos) {
    const scaledRadius = Math.max(this.HIT_RADIUS, this.canvas.width / 50);

    for (let i = 0; i < this.points.length; i++) {
      const dist = Math.sqrt(
        Math.pow(pos.x - this.points[i].x, 2) +
        Math.pow(pos.y - this.points[i].y, 2)
      );
      if (dist < scaledRadius) {
        return i;
      }
    }
    return -1;
  }

  handlePointerDown(e) {
    e.preventDefault();
    const pos = this.getPoint(e);

    // If in preview mode, exit it to show corners for editing
    if (this.previewMode) {
      this.previewMode = false;
      if (this.onExitPreview) {
        this.onExitPreview();
      }
      this.draw();
    }

    const index = this.getPointAt(pos);

    if (index !== -1) {
      // Start dragging existing point
      this.isDragging = true;
      this.dragIndex = index;
    } else if (this.points.length < 4) {
      // Add new point
      this.points.push(pos);

      if (this.points.length === 4) {
        // All 4 points placed - notify ready for approval
        if (this.onReady) {
          this.onReady(this.getPoints());
        }
      }
    }
    this.draw();
  }

  handlePointerMove(e) {
    const pos = this.getPoint(e);

    if (this.isDragging && this.dragIndex !== -1) {
      // Update dragged point position (visual only, no preview update)
      this.points[this.dragIndex] = pos;
      this.draw();
      // Note: Preview updates on pointerUp, not during drag
    } else {
      // Update hover state
      const newHoverIndex = this.getPointAt(pos);
      if (newHoverIndex !== this.hoverIndex) {
        this.hoverIndex = newHoverIndex;

        // Update cursor
        if (this.hoverIndex !== -1) {
          this.canvas.style.cursor = 'move';
        } else if (this.points.length < 4) {
          this.canvas.style.cursor = 'crosshair';
        } else {
          this.canvas.style.cursor = 'default';
        }

        this.draw();
      }
    }
  }

  handlePointerUp(e) {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragIndex = -1;

      // Notify that points changed after drag
      if (this.points.length === 4 && this.onChange) {
        this.onChange(this.getPoints());
      }
    }
  }

  /**
   * Sort points to consistent order: [TL, TR, BR, BL]
   */
  sortPoints(pts) {
    if (pts.length !== 4) return pts;

    // Sort by Y first to get top 2 and bottom 2
    const sortedByY = [...pts].sort((a, b) => a.y - b.y);
    const top = sortedByY.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = sortedByY.slice(2, 4).sort((a, b) => a.x - b.x);

    // Result is [Top-Left, Top-Right, Bottom-Right, Bottom-Left]
    return [top[0], top[1], bottom[1], bottom[0]];
  }

  /**
   * Get the sorted points
   */
  getPoints() {
    return this.sortPoints(this.points);
  }

  /**
   * Check if all 4 points are placed
   */
  allPointsPlaced() {
    return this.points.length === 4;
  }

  /**
   * Undo the last point
   */
  undoLastLine() {
    if (this.points.length > 0) {
      this.points.pop();
      this.draw();
      return true;
    }
    return false;
  }

  /**
   * Check if can undo
   */
  canUndo() {
    return this.points.length > 0;
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

    // In preview mode, just show a clean view (no overlay graphics)
    if (this.previewMode) {
      return;
    }

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

    // Draw rectangle connecting points
    if (this.points.length > 0) {
      const lineWidth = Math.max(2, this.canvas.width / 300);

      ctx.beginPath();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = this.colors.line;
      ctx.moveTo(this.points[0].x, this.points[0].y);

      for (let i = 1; i < this.points.length; i++) {
        ctx.lineTo(this.points[i].x, this.points[i].y);
      }

      // Close the shape if all 4 points
      if (this.points.length === 4) {
        ctx.closePath();
      }
      ctx.stroke();
    }

    // Draw corner points
    const radius = Math.max(5, this.canvas.width / 100);
    const lineWidth = Math.max(2, this.canvas.width / 300);

    this.points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);

      // Color based on state
      if (i === this.dragIndex) {
        ctx.fillStyle = this.colors.pointDrag;
      } else if (i === this.hoverIndex) {
        ctx.fillStyle = this.colors.pointHover;
      } else {
        ctx.fillStyle = this.colors.point;
      }

      ctx.fill();

      // White stroke
      ctx.lineWidth = lineWidth / 2;
      ctx.strokeStyle = 'white';
      ctx.stroke();

      // Point number label
      ctx.fillStyle = 'white';
      ctx.font = `bold ${Math.max(10, radius)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((i + 1).toString(), p.x, p.y);
    });

    // Draw instruction text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const instruction = this.points.length < 4
      ? `Click to place corner ${this.points.length + 1}/4`
      : 'Drag corners to adjust';
    ctx.fillText(instruction, width / 2, 20);
  }

  /**
   * Get lines object for compatibility with old API
   * Converts points to the old lines format
   */
  getLines() {
    // For compatibility - not used with new OpenCV approach
    return { points: this.getPoints() };
  }

  /**
   * Reset the overlay
   */
  reset() {
    this.points = [];
    this.isDragging = false;
    this.dragIndex = -1;
    this.hoverIndex = -1;
    this.previewMode = false;
    this.draw();
  }

  /**
   * Enter preview mode - hides corner markers for clean preview
   */
  enterPreviewMode() {
    this.previewMode = true;
    this.draw();
  }

  /**
   * Exit preview mode - shows corner markers again for editing
   */
  exitPreviewMode() {
    this.previewMode = false;
    this.draw();
  }

  /**
   * Check if in preview mode
   */
  isInPreviewMode() {
    return this.previewMode;
  }

  /**
   * Dispose of resources
   */
  dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.deactivate();
  }
}
