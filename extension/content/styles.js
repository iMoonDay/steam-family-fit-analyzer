"use strict";

globalThis.SFFA_STYLES = String.raw`
      #sffa-root {
        position: fixed;
        inset: 0;
        z-index: 999999;
        pointer-events: none;
        color: #dbe8f3;
        font-family: Motiva Sans, Arial, Helvetica, sans-serif;
      }
      #sffa-root, #sffa-root * {
        box-sizing: border-box;
      }
      .sffa-launcher-wrap {
        position: fixed;
        right: 0;
        top: 58%;
        pointer-events: auto;
        display: inline-flex;
        align-items: stretch;
        transform: translateY(-50%) translateX(22px);
        transition: transform 0.16s ease, opacity 0.16s ease, visibility 0.16s ease;
      }
      .sffa-launcher-wrap:hover {
        transform: translateY(-50%) translateX(0);
      }
      .sffa-launcher-wrap.is-hidden {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      .sffa-launcher-wrap.is-hidden:hover {
        transform: translateY(-50%) translateX(22px);
      }
      .sffa-launcher {
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        min-height: 88px;
        padding: 10px 6px;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-right: 0;
        border-radius: 4px 0 0 4px;
        background: linear-gradient(180deg, #1f3c4f 0%, #183245 100%);
        color: #ffffff;
        cursor: pointer;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
        font: inherit;
        font-size: 12px;
        line-height: 1.15;
        writing-mode: vertical-rl;
        letter-spacing: 0;
        position: relative;
        transition: filter 0.12s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease;
      }
      .sffa-launcher-close {
        position: absolute;
        left: -14px;
        top: -8px;
        width: 16px;
        height: 16px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        background: transparent;
        color: #dbe8f3;
        font: inherit;
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        z-index: 1;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: color 0.12s ease, opacity 0.12s ease, visibility 0.12s ease;
      }
      .sffa-launcher-wrap:hover .sffa-launcher-close {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      .sffa-launcher-close:hover {
        color: #ffffff;
      }
      .sffa-launcher:hover {
        background: linear-gradient(180deg, #27556f 0%, #20465c 100%);
        filter: brightness(1.07);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.48), 0 0 0 1px rgba(143, 209, 255, 0.22) inset;
      }
      .sffa-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(11, 16, 22, 0.72);
        backdrop-filter: blur(2px);
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.16s ease, visibility 0.16s ease;
        pointer-events: none;
      }
      .sffa-shell {
        position: fixed;
        left: 50%;
        top: 50%;
        width: min(1120px, calc(100vw - 28px));
        height: min(860px, calc(100vh - 28px));
        transform: translate(-50%, -50%) scale(0.98);
        opacity: 0;
        visibility: hidden;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 4px;
        background: #171a21;
        box-shadow: 0 28px 72px rgba(0, 0, 0, 0.58);
        transition: opacity 0.16s ease, transform 0.16s ease, visibility 0.16s ease;
      }
      #sffa-root.is-open .sffa-backdrop {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      #sffa-root.is-open .sffa-shell {
        opacity: 1;
        visibility: visible;
        transform: translate(-50%, -50%) scale(1);
      }
      #sffa-root.is-open .sffa-launcher {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      #sffa-root.is-open .sffa-launcher-wrap {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      .sffa-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        background: linear-gradient(180deg, #2a475e 0%, #1b2838 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      .sffa-title {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .sffa-title strong {
        font-size: 15px;
        font-weight: 700;
        color: #ffffff;
        line-height: 1.2;
      }
      .sffa-title span {
        font-size: 12px;
        color: #b8c7d3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sffa-header-actions {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }
      .sffa-icon-btn,
      .sffa-close {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 2px;
        cursor: pointer;
        color: #ffffff;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
      }
      .sffa-icon-btn {
        font-size: 20px;
        line-height: 1;
      }
      .sffa-icon-btn:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-icon-btn[aria-expanded="true"] {
        background: rgba(102, 192, 244, 0.2);
      }
      .sffa-locale-wrap {
        position: relative;
      }
      .sffa-locale-btn {
        height: 30px;
        max-width: 180px;
        padding: 0 9px;
        border: 1px solid rgba(102, 192, 244, 0.24);
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.08);
        color: #dbe8f3;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sffa-locale-btn:hover,
      .sffa-locale-btn[aria-expanded="true"] {
        background: rgba(102, 192, 244, 0.18);
        border-color: rgba(143, 209, 255, 0.42);
      }
      .sffa-locale-menu {
        position: absolute;
        right: 0;
        top: 36px;
        min-width: 138px;
        display: none;
        padding: 6px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        border-radius: 3px;
        background: #0f141b;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
        z-index: 3;
      }
      .sffa-locale-wrap.is-open .sffa-locale-menu {
        display: grid;
        gap: 4px;
      }
      .sffa-locale-option {
        width: 100%;
        min-height: 30px;
        padding: 0 10px;
        border: 0;
        border-radius: 2px;
        background: transparent;
        color: #dbe8f3;
        text-align: left;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        white-space: nowrap;
      }
      .sffa-locale-option:hover {
        background: rgba(102, 192, 244, 0.14);
      }
      .sffa-locale-option.is-active {
        background: rgba(102, 192, 244, 0.22);
        color: #ffffff;
      }
      .sffa-icon-btn:hover,
      .sffa-close:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .sffa-launcher:hover,
      .sffa-icon-btn:hover:not(:disabled),
      .sffa-close:hover:not(:disabled),
      .sffa-menu-item:hover:not(:disabled),
      .sffa-btn:hover:not(:disabled),
      .sffa-tab:hover:not(:disabled) {
        filter: brightness(1.08);
        box-shadow: 0 0 0 1px rgba(143, 209, 255, 0.2) inset;
      }
      .sffa-menu {
        position: absolute;
        right: 36px;
        top: 36px;
        min-width: 190px;
        display: none;
        padding: 6px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        border-radius: 3px;
        background: #0f141b;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
        z-index: 2;
      }
      .sffa-header-actions.is-menu-open .sffa-menu {
        display: grid;
        gap: 4px;
      }
      .sffa-menu-item {
        width: 100%;
        min-height: 32px;
        padding: 0 10px;
        border: 0;
        border-radius: 2px;
        background: transparent;
        color: #dbe8f3;
        text-align: left;
        cursor: pointer;
        font: inherit;
      }
      .sffa-menu-item:hover {
        background: rgba(102, 192, 244, 0.14);
      }
      .sffa-menu-item.danger {
        color: #ffd0d0;
      }
      .sffa-menu-item:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-body {
        min-height: 0;
        flex: 1 1 auto;
        padding: 10px 12px 12px;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 10px;
        overflow: hidden;
      }
      .sffa-content {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-columns: 360px minmax(0, 1fr);
        gap: 12px;
        overflow: hidden;
      }
      .sffa-side {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        gap: 8px;
        overflow: hidden;
      }
      .sffa-main {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 8px;
        overflow: hidden;
      }
      .sffa-row {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .sffa-input {
        flex: 1 1 320px;
        min-width: 0;
        height: 36px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        background: #0f141b;
        color: #f2f7fb;
        border-radius: 3px;
        padding: 0 10px;
        outline: none;
      }
      .sffa-input:focus {
        border-color: #66c0f4;
        box-shadow: 0 0 0 2px rgba(102, 192, 244, 0.12);
      }
      .sffa-history-wrap {
        flex: 1 1 320px;
        min-width: 0;
      }
      .sffa-row > .sffa-list-wrap.sffa-history-wrap {
        flex: 1 1 320px;
        min-width: 0;
      }
      .sffa-history-wrap .sffa-input {
        width: 100%;
      }
      .sffa-history-wrap .sffa-list-menu {
        top: 42px;
        width: 100%;
        max-height: 260px;
        overflow: auto;
        z-index: 5;
      }
      .sffa-history-wrap .sffa-list-option {
        min-height: 44px;
        padding: 6px 10px;
      }
      .sffa-history-option-main {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #f2f7fb;
      }
      .sffa-history-option-sub {
        display: block;
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #8fa6b8;
        font-size: 11px;
      }
      .sffa-btn {
        height: 36px;
        padding: 0 12px;
        border-radius: 3px;
        color: #ffffff;
        background: linear-gradient(180deg, #2a475e 0%, #1b2838 100%);
        border: 1px solid rgba(102, 192, 244, 0.26);
        white-space: nowrap;
        transition: transform 0.12s ease, filter 0.12s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease;
      }
      .sffa-btn:hover:not(:disabled),
      .sffa-tab:hover:not(:disabled),
      .sffa-menu-item:hover:not(:disabled),
      .sffa-icon-btn:hover:not(:disabled),
      .sffa-close:hover:not(:disabled) {
      }
      .sffa-btn.secondary {
        background: linear-gradient(180deg, #3d5568 0%, #2d4355 100%);
        color: #e2edf4;
      }
      .sffa-btn.danger {
        background: linear-gradient(180deg, #6a4448 0%, #4f3135 100%);
        color: #ffe8e8;
      }
      .sffa-btn:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-status {
        min-height: 18px;
        font-size: 12px;
        color: #b8c7d3;
      }
      .sffa-status-row {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .sffa-status-row .sffa-status {
        flex: 1 1 auto;
        min-width: 0;
      }
      .sffa-status.ok {
        color: #9be0ad;
      }
      .sffa-status.warn {
        color: #ffd28c;
      }
      .sffa-status.err {
        color: #ffaaa2;
      }
      .sffa-rate-btn {
        flex: 0 0 auto;
        min-height: 22px;
        padding: 3px 8px;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 3px;
        background: #2d4355;
        color: #e2edf4;
        font: inherit;
        font-size: 12px;
        line-height: 1.2;
        cursor: pointer;
        transition: filter 0.12s ease, border-color 0.12s ease, background 0.12s ease;
      }
      .sffa-rate-btn:hover:not(:disabled) {
        filter: brightness(1.16);
        border-color: rgba(143, 209, 255, 0.66);
      }
      .sffa-rate-btn:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-content: start;
        gap: 6px;
      }
      .sffa-metric {
        min-height: 44px;
        padding: 7px 8px;
        border-radius: 3px;
        background: #1f2b36;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .sffa-metric span {
        display: block;
        font-size: 11px;
        line-height: 1.25;
        color: #9fb3c2;
        margin-bottom: 4px;
      }
      .sffa-metric strong {
        display: block;
        font-size: 15px;
        line-height: 1.05;
        color: #ffffff;
        overflow-wrap: anywhere;
      }
      .sffa-profile {
        min-height: 0;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 3px;
        background: #11161d;
        overflow: auto;
      }
      .sffa-profile-head {
        display: flex;
        gap: 10px;
        align-items: center;
        min-width: 0;
        margin-bottom: 10px;
      }
      .sffa-avatar {
        width: 48px;
        height: 48px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        border-radius: 3px;
        background: #223344;
        color: #dbe8f3;
        font-size: 15px;
        font-weight: 700;
        object-fit: cover;
      }
      .sffa-profile-name {
        min-width: 0;
        color: #ffffff;
        font-size: 14px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .sffa-profile-link {
        display: inline-block;
        margin-top: 4px;
        color: #8fd1ff;
        font-size: 12px;
        text-decoration: none;
      }
      .sffa-target-row {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        gap: 8px;
        align-items: start;
        padding: 6px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 12px;
      }
      .sffa-target-row input {
        margin: 2px 0 0;
      }
      .sffa-target-row span {
        color: #d8e4ee;
        overflow-wrap: anywhere;
      }
      .sffa-profile-row {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        gap: 8px;
        padding: 5px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 12px;
      }
      .sffa-profile-row span:first-child {
        color: #9fb3c2;
      }
      .sffa-profile-row span:last-child {
        color: #d8e4ee;
        overflow-wrap: anywhere;
      }
      .sffa-compare-btn {
        width: 48px;
        height: 48px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        padding: 0;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 3px;
        background: linear-gradient(180deg, #2a475e 0%, #1f3242 100%);
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.1;
        letter-spacing: 0;
        text-align: center;
        transition: filter 0.12s ease, background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
      }
      .sffa-compare-btn:hover:not(:disabled) {
        background: linear-gradient(180deg, #315169 0%, #264050 100%);
        border-color: rgba(143, 209, 255, 0.6);
        filter: brightness(1.05);
      }
      .sffa-compare-btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .sffa-compare-overlay {
        position: fixed;
        inset: 0;
        z-index: 999998;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.16s ease, visibility 0.16s ease;
      }
      .sffa-compare-overlay-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(8, 12, 18, 0.76);
        backdrop-filter: blur(2px);
      }
      .sffa-compare-shell {
        position: absolute;
        left: 50%;
        top: 50%;
        width: min(1120px, calc(100vw - 28px));
        height: min(840px, calc(100vh - 28px));
        transform: translate(-50%, -50%) scale(0.985);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 4px;
        background: #121820;
        box-shadow: 0 28px 72px rgba(0, 0, 0, 0.58);
      }
      #sffa-root.is-compare-open .sffa-compare-overlay {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      .sffa-compare-header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        background: linear-gradient(180deg, #23384a 0%, #17222e 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      .sffa-compare-title {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .sffa-compare-title strong {
        color: #ffffff;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
      }
      .sffa-compare-title span {
        color: #b8c7d3;
        font-size: 12px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .sffa-compare-close {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 18px;
        line-height: 1;
      }
      .sffa-compare-close:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .sffa-compare-summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(252px, 1fr));
        gap: 8px;
        padding: 10px 12px 12px;
        min-height: 0;
        flex: 1 1 auto;
        overflow: auto;
      }
      .sffa-compare-card {
        position: relative;
        min-width: 0;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 3px;
        background: #11161d;
      }
      .sffa-compare-card.is-muted {
        opacity: 0.72;
      }
      .sffa-compare-card-head {
        display: flex;
        gap: 10px;
        align-items: center;
        min-width: 0;
        margin-bottom: 10px;
        padding-right: 0;
      }
      .sffa-compare-card-head.has-status {
        padding-right: 84px;
      }
      .sffa-compare-card-title {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .sffa-compare-card-title strong {
        color: #ffffff;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }
      .sffa-compare-card-title span {
        color: #9fb3c2;
        font-size: 12px;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }
      .sffa-compare-card-summary {
        color: #dbe8f3;
        font-size: 12px;
        line-height: 1.35;
        display: block;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .sffa-compare-card-status {
        position: absolute;
        top: 10px;
        right: 10px;
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        padding: 0 7px;
        border-radius: 999px;
        background: rgba(225, 92, 92, 0.18);
        color: #ffd0d0;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
      }
      .sffa-compare-card-stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }
      .sffa-compare-stat {
        min-width: 0;
        min-height: 42px;
        padding: 7px 8px;
        border-radius: 3px;
        background: #1a2230;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .sffa-compare-stat.is-wide {
        grid-column: 1 / -1;
      }
      .sffa-compare-stat span {
        display: block;
        margin-bottom: 3px;
        color: #9fb3c2;
        font-size: 11px;
        line-height: 1.2;
      }
      .sffa-compare-stat strong {
        display: block;
        color: #ffffff;
        font-size: 14px;
        line-height: 1.1;
        overflow-wrap: anywhere;
      }
      .sffa-compare-stat.is-highlight {
        background: linear-gradient(180deg, rgba(102, 192, 244, 0.22) 0%, rgba(31, 43, 54, 0.92) 100%);
        border-color: rgba(143, 209, 255, 0.34);
      }
      .sffa-compare-price-ranges {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
      }
      .sffa-compare-price-range {
        min-width: 0;
        min-height: 46px;
        padding: 7px 8px;
        border-radius: 3px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: #1a2230;
        color: inherit;
        cursor: pointer;
        font: inherit;
        text-align: left;
        transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
      }
      .sffa-compare-price-range:hover {
        transform: translateY(-1px);
        background: #223044;
        border-color: rgba(143, 209, 255, 0.34);
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
      }
      .sffa-compare-price-range.is-active {
        background: linear-gradient(180deg, rgba(111, 201, 132, 0.24) 0%, rgba(31, 43, 54, 0.94) 100%);
        border-color: rgba(111, 201, 132, 0.58);
        box-shadow: inset 0 0 0 1px rgba(111, 201, 132, 0.18);
      }
      .sffa-compare-price-range.is-active:hover {
        border-color: rgba(163, 238, 181, 0.72);
        box-shadow: inset 0 0 0 1px rgba(111, 201, 132, 0.24), 0 8px 18px rgba(0, 0, 0, 0.22);
      }
      .sffa-compare-price-range span {
        display: block;
        margin-bottom: 3px;
        color: #9fb3c2;
        font-size: 11px;
        line-height: 1.2;
        white-space: nowrap;
      }
      .sffa-compare-price-range strong {
        display: block;
        color: #ffffff;
        font-size: 14px;
        line-height: 1.1;
      }
      .sffa-compare-card-games {
        display: grid;
        gap: 6px;
        margin-top: 10px;
        min-height: 0;
      }
      .sffa-compare-card-games-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .sffa-compare-card-games-head strong {
        color: #ffffff;
        font-size: 12px;
        line-height: 1.2;
      }
      .sffa-compare-card-games-head span {
        color: #9fb3c2;
        font-size: 11px;
      }
      .sffa-compare-card-games-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(172px, 1fr));
        gap: 8px;
      }
      .sffa-compare-card-game {
        position: relative;
        min-width: 0;
        min-height: 148px;
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 4px;
        background-color: #121820;
        background-image: linear-gradient(180deg, rgba(9, 13, 19, 0.12) 0%, rgba(9, 13, 19, 0.68) 100%), var(--sffa-cover, none);
        background-position: center;
        background-repeat: no-repeat;
        background-size: cover;
        box-shadow: inset 0 -44px 72px rgba(0, 0, 0, 0.42);
        overflow: hidden;
      }
      .sffa-compare-card-game-link {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 10px;
        color: inherit;
        text-decoration: none;
      }
      .sffa-compare-card-game-link:hover {
        text-decoration: none;
      }
      .sffa-compare-card-game-title {
        min-width: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        align-self: flex-start;
        max-width: calc(100% - 4px);
        color: #ffffff;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.25;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.72);
        overflow-wrap: anywhere;
      }
      .sffa-compare-card-game-price {
        display: flex;
        position: absolute;
        left: 10px;
        bottom: 10px;
        align-items: center;
        justify-content: center;
        min-height: 23px;
        padding: 0 9px;
        border-radius: 999px;
        background: rgba(8, 12, 18, 0.72);
        color: #ffffff;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.65);
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 18px rgba(0, 0, 0, 0.28);
      }
      .sffa-compare-card-game-price.is-new {
        background: rgba(111, 201, 132, 0.22);
        color: #d5ffe0;
      }
      .sffa-compare-card-game-price.is-overlap {
        background: rgba(102, 192, 244, 0.2);
        color: #d7f0ff;
      }
      .sffa-compare-card-game-price.is-no-value {
        background: rgba(8, 12, 18, 0.68);
        color: #dbe8f3;
      }
      .sffa-compare-card-game-price.is-unsupported {
        background: rgba(225, 170, 92, 0.18);
        color: #ffe4b4;
      }
      .sffa-compare-card-game-price.is-pending {
        background: rgba(150, 156, 167, 0.2);
        color: #f1f4f7;
      }
      .sffa-compare-card-empty {
        padding: 8px 0 2px;
        color: #9fb3c2;
        font-size: 12px;
      }
      .sffa-compare-body {
        display: none;
      }
      .sffa-family-poster-overlay {
        position: fixed;
        inset: 0;
        z-index: 999997;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.16s ease, visibility 0.16s ease;
      }
      .sffa-family-poster-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(8, 12, 18, 0.72);
        backdrop-filter: blur(2px);
      }
      .sffa-family-poster-shell {
        position: absolute;
        left: 50%;
        top: 50%;
        width: min(460px, calc(100vw - 24px));
        transform: translate(-50%, -50%) scale(0.985);
        display: grid;
        gap: 0;
        overflow: visible;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 4px;
        background: #121820;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
      }
      #sffa-root.is-family-poster-open .sffa-family-poster-overlay {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      .sffa-family-poster-header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        background: linear-gradient(180deg, #23384a 0%, #17222e 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      .sffa-family-poster-title {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .sffa-family-poster-title strong {
        color: #ffffff;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
      }
      .sffa-family-poster-title span {
        color: #b8c7d3;
        font-size: 12px;
        line-height: 1.35;
      }
      .sffa-family-poster-close {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 18px;
        line-height: 1;
      }
      .sffa-family-poster-close:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .sffa-family-poster-body {
        display: grid;
        gap: 12px;
        padding: 14px;
      }
      .sffa-family-poster-field {
        display: grid;
        gap: 6px;
      }
      .sffa-family-poster-field > span {
        color: #dbe8f3;
        font-size: 12px;
        line-height: 1.3;
      }
      .sffa-family-poster-sort-wrap {
        position: relative;
        width: 100%;
      }
      .sffa-family-poster-sort-wrap .sffa-list-select {
        width: 100%;
      }
      .sffa-family-poster-sort-wrap .sffa-list-menu {
        width: 100%;
        min-width: 100%;
        max-height: 240px;
        overflow-y: auto;
      }
      .sffa-family-poster-input {
        height: 34px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        background: #0f141b;
        color: #f2f7fb;
        border-radius: 3px;
        padding: 0 10px;
        outline: none;
        font: inherit;
      }
      .sffa-family-poster-input:focus {
        border-color: #66c0f4;
        box-shadow: 0 0 0 2px rgba(102, 192, 244, 0.12);
      }
      .sffa-family-poster-select {
        height: 34px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background:
          linear-gradient(45deg, transparent 50%, currentColor 50%) calc(100% - 14px) calc(50% - 1px) / 6px 6px no-repeat,
          linear-gradient(135deg, currentColor 50%, transparent 50%) calc(100% - 10px) calc(50% - 1px) / 6px 6px no-repeat,
          #223344;
        color: #c2d4df;
        border-radius: 3px;
        padding: 0 30px 0 10px;
        outline: none;
        font: inherit;
        appearance: none;
        cursor: pointer;
      }
      .sffa-family-poster-select:hover {
        background:
          linear-gradient(45deg, transparent 50%, currentColor 50%) calc(100% - 14px) calc(50% - 1px) / 6px 6px no-repeat,
          linear-gradient(135deg, currentColor 50%, transparent 50%) calc(100% - 10px) calc(50% - 1px) / 6px 6px no-repeat,
          #2c4254;
        border-color: rgba(143, 209, 255, 0.28);
        color: #ffffff;
      }
      .sffa-family-poster-select:focus {
        border-color: #66c0f4;
        box-shadow: 0 0 0 2px rgba(102, 192, 244, 0.12);
        background:
          linear-gradient(45deg, transparent 50%, currentColor 50%) calc(100% - 14px) calc(50% - 1px) / 6px 6px no-repeat,
          linear-gradient(135deg, currentColor 50%, transparent 50%) calc(100% - 10px) calc(50% - 1px) / 6px 6px no-repeat,
          #2c4254;
        color: #ffffff;
      }
      .sffa-family-poster-scale-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
      }
      .sffa-family-poster-range {
        width: 100%;
      }
      .sffa-family-poster-scale-row strong {
        color: #ffffff;
        font-size: 12px;
        min-width: 48px;
        text-align: right;
      }
      .sffa-family-poster-scale-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
      }
      .sffa-family-poster-range {
        width: 100%;
      }
      .sffa-family-poster-scale-row strong {
        color: #ffffff;
        font-size: 12px;
        min-width: 48px;
        text-align: right;
      }
      .sffa-family-poster-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 0 14px 14px;
      }
      .sffa-compare-group {
        margin-top: 10px;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 3px;
        background: #11161d;
      }
      .sffa-compare-group:first-child {
        margin-top: 0;
      }
      .sffa-compare-group-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }
      .sffa-compare-group-head strong {
        color: #ffffff;
        font-size: 13px;
        line-height: 1.2;
      }
      .sffa-compare-group-head span {
        color: #9fb3c2;
        font-size: 12px;
      }
      .sffa-compare-list {
        display: grid;
        gap: 6px;
      }
      .sffa-compare-item {
        display: grid;
        grid-template-columns: minmax(0, 1.45fr) minmax(0, 0.9fr) 120px 110px;
        gap: 8px;
        align-items: center;
        min-width: 0;
        padding: 8px 9px;
        border-radius: 3px;
        background: #151d27;
        border: 1px solid rgba(255, 255, 255, 0.05);
      }
      .sffa-compare-item.is-exclusive {
        border-color: rgba(143, 209, 255, 0.16);
      }
      .sffa-compare-item.is-new {
        background: linear-gradient(180deg, rgba(71, 129, 85, 0.24) 0%, rgba(21, 29, 39, 0.96) 100%);
        border-color: rgba(111, 201, 132, 0.28);
      }
      .sffa-compare-item.is-overlap {
        background: linear-gradient(180deg, rgba(55, 96, 145, 0.2) 0%, rgba(21, 29, 39, 0.96) 100%);
        border-color: rgba(102, 192, 244, 0.24);
      }
      .sffa-compare-item.is-unsupported {
        background: linear-gradient(180deg, rgba(127, 94, 36, 0.18) 0%, rgba(21, 29, 39, 0.96) 100%);
        border-color: rgba(225, 170, 92, 0.24);
      }
      .sffa-compare-item.is-no-value {
        background: linear-gradient(180deg, rgba(97, 104, 112, 0.16) 0%, rgba(21, 29, 39, 0.96) 100%);
      }
      .sffa-compare-item.is-pending {
        background: linear-gradient(180deg, rgba(80, 80, 86, 0.18) 0%, rgba(21, 29, 39, 0.96) 100%);
      }
      .sffa-compare-game {
        min-width: 0;
      }
      .sffa-compare-game a {
        color: #8fd1ff;
        text-decoration: none;
        font-weight: 700;
      }
      .sffa-compare-game a:hover {
        text-decoration: underline;
      }
      .sffa-compare-game-meta {
        margin-top: 3px;
        color: #9fb3c2;
        font-size: 11px;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }
      .sffa-compare-owner-tags {
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .sffa-compare-tag {
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        padding: 0 7px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: #dbe8f3;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
      }
      .sffa-compare-tag.is-active {
        background: rgba(102, 192, 244, 0.18);
        color: #8fd1ff;
      }
      .sffa-compare-tag.is-muted {
        background: rgba(255, 255, 255, 0.05);
        color: #9fb3c2;
      }
      .sffa-compare-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 22px;
        padding: 0 8px;
        border-radius: 999px;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
      }
      .sffa-compare-chip.is-new {
        background: rgba(111, 201, 132, 0.18);
        color: #a8efb5;
      }
      .sffa-compare-chip.is-muted {
        background: rgba(255, 255, 255, 0.08);
        color: #dbe8f3;
      }
      .sffa-compare-chip.is-overlap {
        background: rgba(102, 192, 244, 0.16);
        color: #8fd1ff;
      }
      .sffa-compare-chip.is-no-value {
        background: rgba(125, 132, 141, 0.16);
        color: #d7dde2;
      }
      .sffa-compare-chip.is-unsupported {
        background: rgba(225, 170, 92, 0.16);
        color: #ffd28f;
      }
      .sffa-compare-chip.is-pending {
        background: rgba(150, 156, 167, 0.16);
        color: #d7dde2;
      }
      .sffa-compare-empty {
        padding: 18px 0;
        color: #9fb3c2;
        text-align: center;
      }
      .sffa-tabs {
        display: flex;
        gap: 6px;
        min-height: 30px;
        align-items: center;
      }
      .sffa-list-wrap {
        position: relative;
        flex: 0 0 auto;
      }
      .sffa-list-select {
        flex: 0 0 auto;
        height: 30px;
        min-width: 92px;
        padding: 0 24px 0 10px;
        border-radius: 3px;
        background: #223344;
        color: #c2d4df;
        border: 1px solid rgba(255, 255, 255, 0.08);
        font: inherit;
        text-align: left;
        outline: none;
        cursor: pointer;
        position: relative;
      }
      .sffa-list-select::after {
        content: "";
        position: absolute;
        right: 9px;
        top: 50%;
        width: 0;
        height: 0;
        margin-top: -2px;
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
        border-top: 5px solid currentColor;
        opacity: 0.78;
      }
      .sffa-list-select:hover,
      .sffa-list-select[aria-expanded="true"],
      .sffa-list-select.is-active {
        background: #2c4254;
        border-color: rgba(143, 209, 255, 0.34);
        color: #ffffff;
      }
      .sffa-list-menu {
        position: absolute;
        left: 0;
        top: 36px;
        min-width: 112px;
        display: none;
        padding: 6px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        border-radius: 3px;
        background: #0f141b;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
        z-index: 3;
      }
      .sffa-list-wrap.is-open .sffa-list-menu {
        display: grid;
        gap: 4px;
      }
      .sffa-list-option {
        width: 100%;
        min-height: 30px;
        padding: 0 10px;
        border: 0;
        border-radius: 2px;
        background: transparent;
        color: #dbe8f3;
        text-align: left;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        white-space: nowrap;
      }
      .sffa-list-option:hover {
        background: rgba(102, 192, 244, 0.14);
      }
      .sffa-list-option.is-active {
        background: rgba(102, 192, 244, 0.22);
        color: #ffffff;
      }
      .sffa-tab {
        flex: 0 0 auto;
        height: 30px;
        padding: 0 10px;
        border-radius: 3px;
        background: #223344;
        color: #c2d4df;
        border: 1px solid rgba(255, 255, 255, 0.08);
        white-space: nowrap;
        transition: transform 0.12s ease, filter 0.12s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease;
      }
      .sffa-tab:hover:not(:disabled) {
        background: #2c4254;
        border-color: rgba(143, 209, 255, 0.28);
      }
      .sffa-tab.active:hover:not(:disabled) {
        background: linear-gradient(180deg, #66c0f4 0%, #4ea5d8 100%);
        border-color: rgba(143, 209, 255, 0.45);
        filter: brightness(1.05);
      }
      .sffa-tab.active {
        background: linear-gradient(180deg, #66c0f4 0%, #4ea5d8 100%);
        color: #0a1118;
        font-weight: 700;
      }
      .sffa-tab[data-tab="family"] {
        margin-left: auto;
      }
      .sffa-search-wrap {
        position: relative;
        flex: 1 1 180px;
        min-width: 140px;
        max-width: 260px;
      }
      .sffa-view-switch {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 3px;
        background: #18222c;
      }
      .sffa-view-btn {
        height: 24px;
        padding: 0 9px;
        border: 0;
        border-radius: 2px;
        background: transparent;
        color: #9fb3c2;
        cursor: pointer;
        font: inherit;
        font-size: 11px;
        white-space: nowrap;
      }
      .sffa-view-btn:hover {
        color: #dbe8f3;
      }
      .sffa-view-btn.is-active {
        background: linear-gradient(180deg, rgba(102, 192, 244, 0.26) 0%, rgba(62, 126, 164, 0.26) 100%);
        color: #ffffff;
        box-shadow: inset 0 0 0 1px rgba(143, 209, 255, 0.24);
      }
      .sffa-search-input {
        display: block;
        width: 100%;
        height: 30px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        background: #0f141b;
        color: #f2f7fb;
        border-radius: 3px;
        padding: 0 30px 0 9px;
        outline: none;
      }
      .sffa-search-clear {
        position: absolute;
        top: 50%;
        right: 4px;
        width: 24px;
        height: 24px;
        padding: 0;
        transform: translateY(-50%);
        display: grid;
        place-items: center;
        border: 0;
        background: transparent;
        color: #9fb3c2;
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
      }
      .sffa-search-wrap.has-value .sffa-search-clear {
        opacity: 1;
        pointer-events: auto;
      }
      .sffa-search-clear:hover {
        color: #ffffff;
      }
      .sffa-search-clear svg {
        width: 14px;
        height: 14px;
        display: block;
      }
      .sffa-copy-list-wrap {
        position: relative;
      }
      .sffa-copy-list-menu {
        position: absolute;
        right: 0;
        top: 100%;
        margin-top: 4px;
        min-width: 180px;
        display: none;
        padding: 6px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        border-radius: 3px;
        background: #0f141b;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
        z-index: 3;
      }
      .sffa-copy-list-wrap.is-copy-list-open .sffa-copy-list-menu {
        display: grid;
        gap: 4px;
      }
      .sffa-search-input:focus {
        border-color: #66c0f4;
      }
      .sffa-table-wrap {
        min-height: 0;
        overflow: auto;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 3px;
        background: #11161d;
      }
      .sffa-table-wrap.is-cover-view {
        padding: 10px;
        background:
          radial-gradient(circle at top left, rgba(102, 192, 244, 0.08), transparent 26%),
          linear-gradient(180deg, #11161d 0%, #0e141b 100%);
      }
      .sffa-cover-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(198px, 1fr));
        gap: 10px;
      }
      .sffa-cover-card {
        display: grid;
        grid-template-rows: 156px auto;
        min-width: 0;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 4px;
        background: #121820;
        color: inherit;
        text-decoration: none;
        overflow: hidden;
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.22);
        transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease, filter 0.14s ease;
      }
      .sffa-cover-card:hover {
        transform: translateY(-2px);
        border-color: rgba(143, 209, 255, 0.28);
        box-shadow: 0 16px 34px rgba(0, 0, 0, 0.3);
        filter: brightness(1.03);
      }
      .sffa-cover-card-media {
        position: relative;
        display: flex;
        align-items: flex-end;
        min-width: 0;
        padding: 10px;
        background-color: #16202b;
        background-image: linear-gradient(180deg, rgba(9, 13, 19, 0.08) 0%, rgba(9, 13, 19, 0.74) 100%), var(--sffa-cover, none);
        background-position: center;
        background-repeat: no-repeat;
        background-size: cover;
        box-shadow: inset 0 -40px 64px rgba(0, 0, 0, 0.4);
      }
      .sffa-cover-card-title {
        min-width: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.25;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.72);
        overflow-wrap: anywhere;
      }
      .sffa-cover-card-chip {
        position: absolute;
        top: 10px;
        left: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 22px;
        max-width: calc(100% - 20px);
        padding: 0 8px;
        border-radius: 999px;
        background: rgba(8, 12, 18, 0.72);
        color: #ffffff;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 18px rgba(0, 0, 0, 0.28);
      }
      .sffa-cover-card-chip.is-new {
        background: rgba(111, 201, 132, 0.22);
        color: #d5ffe0;
      }
      .sffa-cover-card-chip.is-overlap {
        background: rgba(102, 192, 244, 0.2);
        color: #d7f0ff;
      }
      .sffa-cover-card-chip.is-no-value {
        background: rgba(8, 12, 18, 0.68);
        color: #dbe8f3;
      }
      .sffa-cover-card-chip.is-unsupported {
        background: rgba(225, 170, 92, 0.18);
        color: #ffe4b4;
      }
      .sffa-cover-card-chip.is-pending {
        background: rgba(150, 156, 167, 0.2);
        color: #f1f4f7;
      }
      .sffa-cover-card-body {
        display: grid;
        gap: 4px;
        padding: 10px;
        min-width: 0;
      }
      .sffa-cover-card-appid {
        color: #8fd1ff;
        font-size: 11px;
        line-height: 1.2;
      }
      .sffa-cover-card-meta {
        min-width: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        color: #c9d6e0;
        font-size: 11px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .sffa-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 12px;
      }
      .sffa-table th,
      .sffa-table td {
        padding: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        text-align: left;
        vertical-align: top;
      }
      .sffa-table th {
        position: sticky;
        top: 0;
        background: #0f141b;
        color: #9fb3c2;
        z-index: 1;
      }
      .sffa-table th[data-sort-key] {
        cursor: pointer;
        user-select: none;
      }
      .sffa-table th[data-sort-key]:hover {
        color: #d8e4ee;
        background: #17212b;
      }
      .sffa-sort-indicator {
        display: inline-block;
        min-width: 12px;
        margin-left: 4px;
        color: #8fd1ff;
      }
      .sffa-table td {
        color: #d8e4ee;
      }
      .sffa-table a {
        color: #8fd1ff;
        text-decoration: none;
      }
      .sffa-spinner {
        width: 14px;
        height: 14px;
        display: inline-block;
        vertical-align: -2px;
        border: 2px solid rgba(143, 209, 255, 0.25);
        border-top-color: #8fd1ff;
        border-radius: 50%;
        animation: sffa-spin 0.8s linear infinite;
      }
      .sffa-status-inline {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      @keyframes sffa-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .sffa-empty {
        padding: 18px;
        color: #9fb3c2;
        text-align: center;
      }
      @media (max-width: 680px) {
        .sffa-launcher-wrap {
          right: 0;
          top: 62%;
          transform: translateY(-50%) translateX(22px);
        }
        .sffa-launcher-wrap:hover {
          transform: translateY(-50%) translateX(0);
        }
        .sffa-launcher {
          min-height: 82px;
        }
        .sffa-shell {
          width: calc(100vw - 20px);
          height: calc(100vh - 20px);
        }
        .sffa-body {
          grid-template-rows: auto minmax(0, 1fr);
        }
        .sffa-content {
          grid-template-columns: 1fr;
          grid-template-rows: auto minmax(0, 1fr);
        }
        .sffa-summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .sffa-table {
          min-width: 640px;
        }
        .sffa-table-wrap.is-cover-view {
          padding: 8px;
        }
        .sffa-cover-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .sffa-cover-card {
          grid-template-rows: 136px auto;
        }
        .sffa-compare-shell {
          width: calc(100vw - 16px);
          height: calc(100vh - 16px);
        }
        .sffa-compare-summary {
          grid-template-columns: 1fr;
        }
        .sffa-compare-price-ranges {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .sffa-compare-item {
          grid-template-columns: 1fr;
        }
        .sffa-compare-item > * {
          min-width: 0;
        }
        .sffa-compare-item .sffa-compare-chip {
          width: fit-content;
        }
        .sffa-compare-item .sffa-compare-price {
          justify-self: start;
        }
      }
    `;
