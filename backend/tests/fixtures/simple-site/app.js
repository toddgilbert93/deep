document.querySelector("#evaluate-button")?.addEventListener("click", () => {
  document.body.dataset.evaluated = "true";
  fetch("/api/evaluations");
});
