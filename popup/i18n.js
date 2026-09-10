/* global browser */
"use strict";

/** Translate every element with data-i18n / data-i18n-placeholder / data-i18n-title. */
(function () {
  const t = (key, subs) => {
    try { return browser.i18n.getMessage(key, subs) || key; } catch { return key; }
  };
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const el of document.querySelectorAll("[data-i18n-minutes]")) {
    el.textContent = t("minutes", [el.dataset.i18nMinutes]);
  }
  for (const el of document.querySelectorAll("[data-i18n-min]")) {
    el.textContent = t("min", [el.dataset.i18nMin]);
  }
  window.t = t;
})();
