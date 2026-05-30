const browserApi = typeof browser !== "undefined" ? browser : chrome;

function readBlockedUrl() {
  const marker = "?url=";
  const markerIndex = window.location.href.indexOf(marker);
  const rawUrl = markerIndex === -1 ? "" : window.location.href.slice(markerIndex + marker.length);
  try {
    return new URL(decodeURIComponent(rawUrl));
  } catch (error) {
    try {
      return new URL(rawUrl);
    } catch (nestedError) {
      return null;
    }
  }
}

const blockedUrl = readBlockedUrl();
const hostElement = document.querySelector("#blocked-host");
hostElement.textContent = blockedUrl ? blockedUrl.hostname : "此页面";

document.querySelector("#manage-button").addEventListener("click", () => {
  browserApi.runtime.openOptionsPage();
});
