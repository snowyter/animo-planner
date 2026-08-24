function (config) {
  "use strict";

  // The initialization script runs on every top-level navigation of the
  // capture window; the guard makes a double injection in one document a
  // no-op. Everything else stays inside this closure: the bearer token is
  // never exposed on the window object.
  if (!config || window.__animoPlanCaptureActive === true) {
    return;
  }

  var DEBOUNCE_MS = 300;
  var lastHash = null;
  var pendingTimer = null;
  var tableObserver = null;
  var observedTable = null;

  function hashString(value) {
    var hash = 5381;
    for (var i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
  }

  // The page renders select2 over the course dropdown, and the current
  // selection shows up in the select2 container rather than as a `selected`
  // attribute on the option. The container text is matched against the
  // dropdown options first; the `selected` attribute is the fallback. An
  // unreadable selection means no capture: guessing an identity would orphan
  // the posted sections.
  function readCourseIdentity() {
    var dropdown = document.querySelector(config.selectors.courseDropdown);
    if (!dropdown) {
      return null;
    }
    var options = dropdown.querySelectorAll("option");
    var dropdownId = config.selectors.courseDropdown.charAt(0) === "#"
      ? config.selectors.courseDropdown.slice(1)
      : config.selectors.courseDropdown;
    var container = document.getElementById("select2-" + dropdownId + "-container");
    var selectedText = container ? (container.textContent || "").trim() : "";
    var chosen = null;
    if (selectedText !== "") {
      for (var i = 0; i < options.length; i += 1) {
        if ((options[i].textContent || "").trim() === selectedText) {
          chosen = options[i];
          break;
        }
      }
    }
    if (!chosen) {
      for (var j = 0; j < options.length; j += 1) {
        if (options[j].hasAttribute("selected")) {
          chosen = options[j];
          break;
        }
      }
    }
    if (!chosen) {
      return null;
    }
    var courseId = parseInt(chosen.getAttribute("value"), 10);
    if (!isFinite(courseId)) {
      return null;
    }
    var text = (chosen.textContent || "").trim();
    var separator = text.indexOf(" - ");
    if (separator < 0) {
      return null;
    }
    return {
      courseId: courseId,
      courseCode: text.slice(0, separator).trim(),
      courseTitle: text.slice(separator + 3).trim()
    };
  }

  function capture() {
    var table = document.querySelector(config.selectors.resultsTable);
    if (!table) {
      return;
    }
    if (table.querySelectorAll(config.selectors.resultRow).length === 0) {
      return;
    }

    // The refresh driver (ticket 26) forces its very next render through the
    // dedupe — refreshing the course already on screen re-renders identical
    // bytes, and that response must still land. One-shot: consumed here.
    var forced = window.__animoPlanForceNextCapture === true;
    window.__animoPlanForceNextCapture = false;

    var identity = readCourseIdentity();
    if (!identity) {
      return;
    }

    var hash = hashString(table.outerHTML + "|" + identity.courseId);
    if (!forced && hash === lastHash) {
      return;
    }
    lastHash = hash;

    var payload = {
      campusId: config.campusId,
      sessionId: config.sessionId,
      courseId: identity.courseId,
      courseCode: identity.courseCode,
      courseTitle: identity.courseTitle,
      html: table.outerHTML
    };
    fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + config.token
      },
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (!response.ok) {
        lastHash = null;
      }
    }).catch(function () {
      lastHash = null;
    });
  }

  function scheduleCapture() {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
    }
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      capture();
    }, DEBOUNCE_MS);
  }

  function detachTableObserver() {
    if (tableObserver !== null) {
      tableObserver.disconnect();
      tableObserver = null;
    }
    observedTable = null;
  }

  function attachTableObserver() {
    var table = document.querySelector(config.selectors.resultsTable);
    if (table === observedTable) {
      return;
    }
    detachTableObserver();
    if (!table) {
      return;
    }
    observedTable = table;
    var target = document.querySelector(config.selectors.resultsBody) || table;
    tableObserver = new MutationObserver(scheduleCapture);
    tableObserver.observe(target, { childList: true, subtree: true });
    scheduleCapture();
  }

  function start() {
    if (!window.location || window.location.hostname !== config.hubHost) {
      return;
    }
    window.__animoPlanCaptureActive = true;
    attachTableObserver();
    new MutationObserver(attachTableObserver).observe(document, {
      childList: true,
      subtree: true
    });
  }

  start();
}
