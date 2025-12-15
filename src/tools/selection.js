/**
 * Shared selection utilities for tools that support face selection
 */

/**
 * Handle face selection with shift-click support
 *
 * @param {PointerEvent} e - The pointer event
 * @param {Face} face - The face that was clicked
 * @param {Face[]} selectedFaces - Current selection array (will be mutated)
 * @param {SelectTool} selectTool - Reference to SelectTool for visual updates
 * @param {Function} onFaceSelected - Callback when selection changes
 * @returns {Face[]} The updated selection array
 */
export function handleFaceSelection(e, face, selectedFaces, selectTool, onFaceSelected) {
  const isAlreadySelected = selectedFaces.some(f => f.id === face.id);

  if (e.shiftKey) {
    // Shift-click: toggle face in selection
    if (isAlreadySelected) {
      // Remove from selection
      const newSelection = selectedFaces.filter(f => f.id !== face.id);
      selectedFaces.length = 0;
      selectedFaces.push(...newSelection);
      if (selectTool) {
        selectTool.toggleFaceSelection(face);
      }
    } else {
      // Add to selection
      selectedFaces.push(face);
      if (selectTool) {
        selectTool.toggleFaceSelection(face);
      }
    }

    // Notify callback
    if (onFaceSelected) {
      onFaceSelected([...selectedFaces]);
    }

    return selectedFaces;
  }

  if (!isAlreadySelected) {
    // No shift: replace selection with clicked face
    selectedFaces.length = 0;
    selectedFaces.push(face);

    // Update selection highlight via selectTool
    if (selectTool) {
      selectTool.clearSelection();
      selectTool.selectFace(face);
    }

    // Notify callback
    if (onFaceSelected) {
      onFaceSelected([face]);
    }
  }

  return selectedFaces;
}

/**
 * Check if a face is in the selection
 * @param {Face} face - Face to check
 * @param {Face[]} selectedFaces - Current selection array
 * @returns {boolean}
 */
export function isFaceSelected(face, selectedFaces) {
  return selectedFaces.some(f => f.id === face.id);
}
