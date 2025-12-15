/**
 * AlignmentPanel - Split view panel for perspective correction
 * Left panel shows source image with 4-corner selection
 * Right panel (3D viewport) shows live preview of rectified result
 */
export class AlignmentPanel {
  constructor() {
    // DOM Elements
    this.app = document.getElementById('app');
    this.panel = document.getElementById('align-panel');
    this.canvas = document.getElementById('align-canvas');
    this.ctx = this.canvas.getContext('2d');

    // UI Elements
    this.pointCounter = document.getElementById('align-point-count');
    this.ratioSlider = document.getElementById('align-ratio-slider');
    this.ratioValue = document.getElementById('align-ratio-value');
    this.btnClear = document.getElementById('align-clear');
    this.btnSkip = document.getElementById('align-skip');
    this.btnConfirm = document.getElementById('align-confirm');

    // State
    this.image = null;
    this.points = [];
    this.isDragging = false;
    this.dragIndex = -1;
    this.hoverIndex = -1;
    this.ratioScale = 1.0;

    // Hit detection
    this.HIT_RADIUS = 20;

    // Colors
    this.colors = {
      line: '#949DFF',
      point: '#E3E3E3',
      pointHover: '#949DFF',
      pointDrag: '#22c55e',
      guide: 'rgba(148, 157, 255, 0.3)'
    };

    // Callbacks
    this.onPointsChange = null;  // Called when points change (for live preview)
    this.onConfirm = null;       // Called when user confirms
    this.onSkip = null;          // Called when user skips

    // Bind methods
    this.handleResize = this.handleResize.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleRatioChange = this.handleRatioChange.bind(this);
  }

  /**
   * Activate the alignment panel with an image
   * @param {HTMLImageElement} image - The image to align
   */
  activate(image) {
    this.image = image;
    this.points = [];
    this.ratioScale = 1.0;
    this.ratioSlider.value = 1.0;
    this.ratioValue.textContent = '1.00';

    // Enter split mode
    this.app.classList.add('split-mode');

    // Setup canvas
    this.fitCanvasToImage();

    // Add event listeners
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointerleave', this.handlePointerUp);

    this.ratioSlider.addEventListener('input', this.handleRatioChange);

    this.btnClear.addEventListener('click', () => this.clearPoints());
    this.btnSkip.addEventListener('click', () => this.skip());
    this.btnConfirm.addEventListener('click', () => this.confirm());

    window.addEventListener('resize', this.handleResize);

    // Update UI
    this.updateUI();
    this.draw();
  }

  /**
   * Deactivate the alignment panel
   */
  deactivate() {
    // Exit split mode
    this.app.classList.remove('split-mode');

    // Remove event listeners
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerUp);

    this.ratioSlider.removeEventListener('input', this.handleRatioChange);

    window.removeEventListener('resize', this.handleResize);

    // Clear state
    this.image = null;
    this.points = [];
  }

  /**
   * Fit canvas to image while maintaining aspect ratio
   */
  fitCanvasToImage() {
    if (!this.image) return;

    const container = this.panel.querySelector('.panel-content');
    const padding = 40;
    const maxWidth = container.clientWidth - padding;
    const maxHeight = container.clientHeight - padding;

    const imgRatio = this.image.width / this.image.height;
    const containerRatio = maxWidth / maxHeight;

    let displayWidth, displayHeight;

    if (containerRatio > imgRatio) {
      displayHeight = maxHeight;
      displayWidth = displayHeight * imgRatio;
    } else {
      displayWidth = maxWidth;
      displayHeight = displayWidth / imgRatio;
    }

    // Set canvas to image dimensions (for accurate point mapping)
    this.canvas.width = this.image.width;
    this.canvas.height = this.image.height;

    // Set display size
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;
  }

  handleResize() {
    this.fitCanvasToImage();
    this.draw();
  }

  /**
   * Get canvas coordinates from pointer event
   */
  getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  /**
   * Find point at position
   */
  getPointAt(pos) {
    const scaledRadius = Math.max(this.HIT_RADIUS, this.canvas.width / 40);

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
    const index = this.getPointAt(pos);

    if (index !== -1) {
      // Start dragging existing point
      this.isDragging = true;
      this.dragIndex = index;
    } else if (this.points.length < 4) {
      // Add new point
      this.points.push(pos);
      this.updateUI();
      this.draw();

      if (this.points.length === 4) {
        this.notifyPointsChange();
      }
    }
  }

  handlePointerMove(e) {
    const pos = this.getPoint(e);

    if (this.isDragging && this.dragIndex !== -1) {
      this.points[this.dragIndex] = pos;
      this.draw();
    } else {
      const newHoverIndex = this.getPointAt(pos);
      if (newHoverIndex !== this.hoverIndex) {
        this.hoverIndex = newHoverIndex;
        this.updateCursor();
        this.draw();
      }
    }
  }

  handlePointerUp(e) {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragIndex = -1;

      if (this.points.length === 4) {
        this.notifyPointsChange();
      }
    }
  }

  handleRatioChange(e) {
    this.ratioScale = parseFloat(e.target.value);
    this.ratioValue.textContent = this.ratioScale.toFixed(2);

    if (this.points.length === 4) {
      this.notifyPointsChange();
    }
  }

  updateCursor() {
    if (this.hoverIndex !== -1) {
      this.canvas.style.cursor = 'move';
    } else if (this.points.length < 4) {
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  updateUI() {
    this.pointCounter.textContent = this.points.length;
    this.btnConfirm.disabled = this.points.length < 4;
    this.updateCursor();
  }

  /**
   * Sort points to consistent order: [TL, TR, BR, BL]
   */
  sortPoints(pts) {
    if (pts.length !== 4) return pts;

    const sortedByY = [...pts].sort((a, b) => a.y - b.y);
    const top = sortedByY.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = sortedByY.slice(2, 4).sort((a, b) => a.x - b.x);

    return [top[0], top[1], bottom[1], bottom[0]];
  }

  /**
   * Get sorted points
   */
  getPoints() {
    return this.sortPoints(this.points);
  }

  /**
   * Notify that points changed (for live preview)
   */
  notifyPointsChange() {
    if (this.onPointsChange && this.points.length === 4) {
      this.onPointsChange({
        points: this.getPoints(),
        ratioScale: this.ratioScale,
        image: this.image
      });
    }
  }

  /**
   * Clear all points
   */
  clearPoints() {
    this.points = [];
    this.updateUI();
    this.draw();
  }

  /**
   * Skip alignment
   */
  skip() {
    if (this.onSkip) {
      this.onSkip();
    }
    this.deactivate();
  }

  /**
   * Confirm alignment
   */
  confirm() {
    if (this.points.length < 4) return;

    if (this.onConfirm) {
      this.onConfirm({
        points: this.getPoints(),
        ratioScale: this.ratioScale,
        image: this.image
      });
    }
    this.deactivate();
  }

  /**
   * Draw the canvas
   */
  draw() {
    const ctx = this.ctx;

    // Clear and draw image
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.image) {
      ctx.drawImage(this.image, 0, 0);
    }

    // Draw guide lines (center cross)
    ctx.strokeStyle = this.colors.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 10]);

    // Vertical center
    ctx.beginPath();
    ctx.moveTo(this.canvas.width / 2, 0);
    ctx.lineTo(this.canvas.width / 2, this.canvas.height);
    ctx.stroke();

    // Horizontal center
    ctx.beginPath();
    ctx.moveTo(0, this.canvas.height / 2);
    ctx.lineTo(this.canvas.width, this.canvas.height / 2);
    ctx.stroke();

    ctx.setLineDash([]);

    // Draw connecting lines
    if (this.points.length > 0) {
      const lineWidth = Math.max(2, this.canvas.width / 300);

      ctx.beginPath();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = this.colors.line;
      ctx.moveTo(this.points[0].x, this.points[0].y);

      for (let i = 1; i < this.points.length; i++) {
        ctx.lineTo(this.points[i].x, this.points[i].y);
      }

      if (this.points.length === 4) {
        ctx.closePath();
      }
      ctx.stroke();
    }

    // Draw corner points
    const radius = Math.max(8, this.canvas.width / 80);
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

      // Border
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.stroke();

      // Point number
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.max(12, radius)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((i + 1).toString(), p.x, p.y);
    });
  }
}
