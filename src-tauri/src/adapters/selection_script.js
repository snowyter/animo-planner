function (task) {
  "use strict";

  // Drives one course selection in the Course Finder popup (ticket 26).
  // The page renders select2 over this dropdown, so setting the underlying
  // <select> alone is not enough: the selection is moved, then a bubbling
  // `change` event fires — exactly what the student's own click produces —
  // so select2 updates and the page's own search path runs. No other page
  // interaction is introduced and nothing about the login is touched.
  var dropdown = document.querySelector(task.dropdownSelector);
  if (!dropdown || !dropdown.options) {
    return;
  }

  var target = String(task.courseId);
  var found = -1;
  for (var i = 0; i < dropdown.options.length; i += 1) {
    if (String(dropdown.options[i].value) === target) {
      found = i;
      break;
    }
  }
  if (found < 0) {
    return;
  }

  // The observer dedupes byte-identical renders; a refresh of the course
  // already on screen must still land, so the very next capture is forced
  // through (one-shot, consumed by the capture script).
  window[task.forceFlag] = true;

  dropdown.selectedIndex = found;
  dropdown.dispatchEvent(new Event("change", { bubbles: true }));
}
