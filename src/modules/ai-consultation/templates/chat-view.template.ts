export function getChatViewHtml(logId: string): string {
  return `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trợ lý ảo AI - TH PropTech</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&family=Space+Grotesk:wght@300..700&family=Be+Vietnam+Pro:wght@300..700&display=swap');
    
    :root {
      --bg: #faf7f2;
      --surface: #fffdf9;
      --surface-muted: #f4eee7;
      --fg: #2b211e;
      --muted: #7a6a61;
      --primary: #c65a3a;
      --primary-hover: #9f3f2a;
      --border: #e3d8d0;
      --border-light: rgba(227, 216, 208, 0.4);
      --success: #6b8e4e;
      --danger: #d64545;
    }
    
    body.dark {
      --bg: #0f0c0b;
      --surface: #181413;
      --surface-muted: #241e1d;
      --fg: #fffdf9;
      --muted: #a49389;
      --primary: #c65a3a;
      --primary-hover: #e57654;
      --border: #3b322f;
      --border-light: rgba(59, 50, 47, 0.4);
      --success: #88b368;
      --danger: #e95d5d;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Be Vietnam Pro', sans-serif;
      background: var(--bg);
      color: var(--fg);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      transition: background 0.3s, color 0.3s;
      overflow-x: hidden;
      position: relative;
    }
    
    .grid-bg {
      position: absolute;
      inset: 0;
      background-image: linear-gradient(var(--border) 0.5px, transparent 0.5px),
                        linear-gradient(90deg, var(--border) 0.5px, transparent 0.5px);
      background-size: 40px 40px;
      opacity: 0.12;
      pointer-events: none;
      z-index: 1;
    }
    
    .glow-blob-1 {
      position: absolute;
      top: -20%;
      right: -20%;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      background: var(--primary);
      filter: blur(120px);
      opacity: 0.15;
      pointer-events: none;
      z-index: 1;
    }
    
    .glow-blob-2 {
      position: absolute;
      bottom: -20%;
      left: -20%;
      width: 400px;
      height: 400px;
      border-radius: 50%;
      background: var(--success);
      filter: blur(120px);
      opacity: 0.1;
      pointer-events: none;
      z-index: 1;
    }
    
    .tech-coords {
      position: absolute;
      left: 24px;
      top: 100px;
      font-family: monospace;
      font-size: 8px;
      line-height: 1.6;
      opacity: 0.25;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      pointer-events: none;
      z-index: 2;
    }
    
    header {
      position: relative;
      z-index: 10;
      width: 100%;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-light);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    
    .logo-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .logo {
      font-family: 'Lora', Georgia, serif;
      font-size: 20px;
      font-weight: 700;
      color: var(--primary);
      letter-spacing: -0.02em;
    }
    
    .badge {
      font-family: monospace;
      font-size: 9px;
      text-transform: uppercase;
      opacity: 0.6;
      padding: 2px 6px;
      border: 1px solid var(--border);
      border-radius: 4px;
    }
    
    .theme-toggle {
      background: transparent;
      border: 1px solid var(--border-light);
      color: var(--fg);
      padding: 8px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, border-color 0.2s;
    }
    
    .theme-toggle:hover {
      background: rgba(227, 216, 208, 0.15);
      border-color: var(--primary);
    }
    
    main {
      position: relative;
      z-index: 10;
      flex: 1;
      max-width: 1000px;
      width: 100%;
      margin: 0 auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    
    .dashboard-grid {
      display: flex;
      gap: 24px;
      width: 100%;
      align-items: stretch;
      transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
      flex: 1;
    }
    
    .visualizer-card {
      flex: 1.5;
      align-items: center;
      justify-content: center;
      transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    
    .chat-card {
      flex: 1;
      max-width: 420px;
      transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    
    .dashboard-grid.chat-collapsed .chat-card {
      flex: 0;
      max-width: 0;
      padding: 0;
      margin: 0;
      border: none;
      opacity: 0;
      pointer-events: none;
    }
    
    .dashboard-grid.chat-collapsed .visualizer-card {
      flex: 1;
    }
    
    @media (max-width: 768px) {
      .dashboard-grid {
        flex-direction: column;
      }
      .chat-card {
        max-width: 100%;
        height: 380px;
      }
      .dashboard-grid.chat-collapsed .chat-card {
        max-height: 0;
        height: 0;
        padding: 0;
        margin: 0;
        border: none;
        opacity: 0;
      }
    }
    
    .card {
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 4px 12px rgba(43, 33, 30, 0.03);
      display: flex;
      flex-direction: column;
      position: relative;
    }
    
    .visualizer-card {
      align-items: center;
      justify-content: center;
    }
    
    .status-indicator {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 24px;
    }
    
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--danger);
      transition: background 0.3s;
    }
    
    .status-dot.active {
      background: var(--success);
      animation: pulse-dot 1.5s infinite;
    }
    
    @keyframes pulse-dot {
      0% { opacity: 0.6; }
      50% { opacity: 1; }
      100% { opacity: 0.6; }
    }
    
    .orb-wrapper {
      position: relative;
      width: 160px;
      height: 160px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 36px;
      margin-bottom: 48px;
      transform: scale(1.4);
      transition: transform 0.3s ease;
    }
    
    .outer-orb {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: var(--primary);
      opacity: 0.06;
      transform: scale(0.95);
      transition: transform 0.5s, opacity 0.5s;
    }
    
    .outer-orb.active {
      opacity: 0.25;
      animation: micPulse 2s ease-in-out infinite;
    }
    
    .outer-orb.speaking {
      opacity: 0.3;
      animation: orbPulse 1.5s ease-in-out infinite;
    }
    
    .inner-orb {
      width: 110px;
      height: 110px;
      border-radius: 50%;
      background: var(--surface-muted);
      border: 4px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 24px rgba(43, 33, 30, 0.05);
      transition: background 0.5s, border-color 0.5s, transform 0.5s;
      z-index: 2;
    }
    
    .inner-orb.active {
      background: var(--success);
      border-color: var(--surface);
      color: #fffdf9;
      transform: scale(1.02);
    }
    
    .inner-orb.speaking {
      background: var(--primary);
      border-color: var(--surface);
      color: #fffdf9;
      transform: scale(1.05);
    }
    
    @keyframes soundwave {
      0%, 100% { transform: scaleY(0.35); }
      50% { transform: scaleY(1.3); }
    }
    
    @keyframes orbPulse {
      0%, 100% { transform: scale(1.05); box-shadow: 0 0 24px rgba(198, 90, 58, 0.4); }
      50% { transform: scale(1.2); box-shadow: 0 0 48px rgba(198, 90, 58, 0.8); }
    }
    
    @keyframes micPulse {
      0%, 100% { transform: scale(1.02); box-shadow: 0 0 20px rgba(107, 142, 78, 0.3); }
      50% { transform: scale(1.15); box-shadow: 0 0 40px rgba(107, 142, 78, 0.7); }
    }
    
    .wave-bars {
      display: none;
      align-items: center;
      gap: 6px;
      height: 32px;
    }
    
    .wave-bar {
      width: 4px;
      background: #fffdf9;
      border-radius: 20px;
      transform-origin: bottom;
    }
    
    .wave-bar:nth-child(1) { height: 60%; animation: soundwave 0.8s ease-in-out infinite; }
    .wave-bar:nth-child(2) { height: 100%; animation: soundwave 0.6s ease-in-out infinite 0.1s; }
    .wave-bar:nth-child(3) { height: 40%; animation: soundwave 0.7s ease-in-out infinite 0.2s; }
    .wave-bar:nth-child(4) { height: 80%; animation: soundwave 0.5s ease-in-out infinite 0.15s; }
    .wave-bar:nth-child(5) { height: 50%; animation: soundwave 0.8s ease-in-out infinite 0.05s; }
    
    .status-text-detail {
      font-weight: 700;
      font-size: 13px;
      text-align: center;
      margin-bottom: 8px;
    }
    
    .status-desc {
      font-size: 10px;
      color: var(--muted);
      text-align: center;
      line-height: 1.5;
      max-width: 220px;
    }
    
    .btn-group {
      margin-top: 24px;
      display: flex;
      gap: 12px;
    }
    
    .btn {
      padding: 10px 20px;
      border-radius: 30px;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--fg);
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.2s, border-color 0.2s, color 0.2s;
    }
    
    .btn:hover {
      background: var(--surface-muted);
    }
    
    .btn-primary {
      background: var(--primary);
      border-color: var(--primary);
      color: #fffdf9;
    }
    
    .btn-primary:hover {
      background: var(--primary-hover);
    }
    
    .btn-danger {
      background: var(--danger);
      border-color: var(--danger);
      color: #fffdf9;
    }
    
    .chat-card {
      height: 480px;
    }
    
    .chat-header {
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-light);
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    
    .chat-header h3 {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: var(--muted);
    }
    
    .chat-log {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-right: 4px;
    }
    
    .message-bubble {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 12px;
      line-height: 1.5;
      position: relative;
    }
    
    .message-bubble.user {
      align-self: flex-end;
      background: var(--primary);
      color: #fffdf9;
      border-top-right-radius: 0;
    }
    
    .message-bubble.assistant {
      align-self: flex-start;
      background: var(--surface-muted);
      color: var(--fg);
      border-top-left-radius: 0;
    }
    
    .chat-form {
      margin-top: 12px;
      display: flex;
      gap: 8px;
    }
    
    .chat-input {
      flex: 1;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-muted);
      color: var(--fg);
      font-size: 12px;
      outline: none;
      transition: border-color 0.2s;
    }
    
    .chat-input:focus {
      border-color: var(--primary);
    }
    
    .send-btn {
      background: var(--primary);
      border: none;
      color: #fffdf9;
      padding: 10px 14px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    
    .send-btn:hover {
      background: var(--primary-hover);
    }

    /* Completed Overlay */
    .completed-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 12, 11, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      opacity: 0;
      transition: opacity 0.4s ease;
    }
    
    .completed-overlay.show {
      display: flex;
      opacity: 1;
    }
    
    .completed-modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 40px;
      max-width: 440px;
      width: 90%;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
      transform: translateY(20px);
      transition: transform 0.4s ease;
    }
    
    .completed-overlay.show .completed-modal {
      transform: translateY(0);
    }
    
    .completed-icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: rgba(107, 142, 78, 0.15);
      color: var(--success);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    
    .completed-title {
      font-family: 'Lora', Georgia, serif;
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 12px;
      color: var(--fg);
    }
    
    .completed-desc {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.6;
      margin-bottom: 32px;
    }
    
    .completed-action-box {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 24px;
    }
    
    .completed-btn-primary {
      padding: 14px 24px;
      background: var(--primary);
      color: #fffdf9;
      border-radius: 30px;
      font-weight: 700;
      font-size: 13px;
      text-decoration: none;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background 0.2s;
    }
    
    .completed-btn-primary:hover {
      background: var(--primary-hover);
    }
    
    .completed-btn-secondary {
      padding: 14px 24px;
      background: var(--surface-muted);
      color: var(--fg);
      border-radius: 30px;
      font-weight: 700;
      font-size: 13px;
      text-decoration: none;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px solid var(--border);
      transition: background 0.2s;
    }
    
    .completed-btn-secondary:hover {
      background: var(--border);
    }
    
    .completed-countdown {
      font-size: 11px;
      color: var(--muted);
    }

    /* Mascot/Alien Bot Style */
    .alien-bot-wrap {
      position: relative;
      width: 160px;
      height: 160px;
      display: none;
      align-items: center;
      justify-content: center;
      animation: alien-float 4s infinite alternate ease-in-out;
      cursor: pointer;
    }
    
    @keyframes alien-float {
      0% { transform: translateY(0); }
      100% { transform: translateY(-10px); }
    }
    
    .alien-bot {
      position: relative;
      width: 110px;
      height: 120px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    
    .alien-antenna {
      width: 4px;
      height: 20px;
      background: linear-gradient(to top, var(--primary), var(--success));
      border-radius: 2px;
      position: relative;
    }
    
    .antenna-glow {
      width: 10px;
      height: 10px;
      background: var(--success);
      border-radius: 50%;
      position: absolute;
      top: -8px;
      left: 50%;
      transform: translateX(-50%);
      box-shadow: 0 0 10px var(--success);
      animation: pulse-antenna 1.5s infinite alternate ease-in-out;
    }
    
    @keyframes pulse-antenna {
      0% { transform: translateX(-50%) scale(0.8); opacity: 0.7; }
      100% { transform: translateX(-50%) scale(1.3); opacity: 1; box-shadow: 0 0 18px var(--success); }
    }
    
    .alien-head {
      width: 90px;
      height: 80px;
      background: var(--surface-muted);
      border: 2px solid var(--border);
      border-radius: 30px 30px 24px 24px;
      position: relative;
      box-shadow: 
        0 12px 24px rgba(0, 0, 0, 0.15),
        inset 0 0 15px rgba(198, 90, 58, 0.1);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding-top: 6px;
      transition: all 0.3s ease;
    }
    
    .alien-ears {
      position: absolute;
      width: 102px;
      height: 16px;
      top: 45%;
      left: -6px;
      z-index: -1;
      display: flex;
      justify-content: space-between;
    }
    
    .alien-ears::before, .alien-ears::after {
      content: '';
      width: 8px;
      height: 20px;
      background: linear-gradient(135deg, var(--primary), var(--success));
      border-radius: 4px;
    }
    
    .alien-ears::before { transform: rotate(-20deg); }
    .alien-ears::after { transform: rotate(20deg); }
    
    .alien-eyes {
      display: flex;
      gap: 14px;
      margin-bottom: 10px;
    }
    
    .eye {
      width: 20px;
      height: 20px;
      background: var(--surface);
      border: 1.5px solid var(--border);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
    }
    
    .pupil {
      width: 10px;
      height: 10px;
      background: var(--primary);
      border-radius: 50%;
      box-shadow: 0 0 6px var(--primary);
      animation: eye-blink 4s infinite alternate ease-in-out;
      transition: all 0.2s ease;
    }
    
    @keyframes eye-blink {
      0%, 90%, 100% { transform: scaleY(1); }
      95% { transform: scaleY(0.1); }
    }
    
    .alien-mouth {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      height: 10px;
    }
    
    .mouth-bar {
      width: 3px;
      height: 3px;
      background: var(--border);
      border-radius: 1.5px;
      transition: all 0.2s ease;
    }
    
    /* Speaking Mascot */
    .alien-bot-wrap.speaking .antenna-glow {
      background: var(--primary);
      box-shadow: 0 0 15px var(--primary);
    }
    
    .alien-bot-wrap.speaking .alien-head {
      border-color: var(--primary);
      box-shadow: 0 12px 24px rgba(198, 90, 58, 0.25);
    }
    
    .alien-bot-wrap.speaking .pupil {
      background: var(--primary);
      box-shadow: 0 0 8px var(--primary);
    }
    
    .alien-bot-wrap.speaking .mouth-bar {
      background: var(--primary);
      box-shadow: 0 0 6px var(--primary);
      animation: speak-wave 0.6s infinite alternate ease-in-out;
    }
    
    .alien-bot-wrap.speaking .mouth-bar:nth-child(1) { animation-delay: 0.1s; }
    .alien-bot-wrap.speaking .mouth-bar:nth-child(2) { animation-delay: 0.3s; }
    .alien-bot-wrap.speaking .mouth-bar:nth-child(3) { animation-delay: 0.2s; }
    
    @keyframes speak-wave {
      0% { height: 3px; }
      100% { height: 12px; }
    }
    
    /* Thinking Mascot */
    .alien-bot-wrap.thinking .alien-head {
      border-color: var(--success);
      box-shadow: 0 12px 24px rgba(107, 142, 78, 0.25);
    }
    
    /* Modern AI Assistant Style */
    .modern-ai-wrap {
      position: relative;
      width: 160px;
      height: 160px;
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    
    .modern-ai-rings {
      position: relative;
      width: 100px;
      height: 100px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .modern-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 1.5px solid transparent;
      mix-blend-mode: screen;
      animation: modern-spin 8s linear infinite;
    }
    
    .ring-blue {
      border-top-color: var(--primary);
      border-bottom-color: var(--primary);
      box-shadow: 0 0 10px var(--primary);
      animation-duration: 4s;
    }
    
    .ring-purple {
      border-left-color: var(--success);
      border-right-color: var(--success);
      box-shadow: 0 0 10px var(--success);
      animation-duration: 6s;
      animation-direction: reverse;
      transform: scale(0.9);
    }
    
    .ring-pink {
      border-top-color: var(--primary-hover);
      border-left-color: var(--primary-hover);
      box-shadow: 0 0 10px var(--primary-hover);
      animation-duration: 3s;
      transform: scale(0.8);
    }
    
    .modern-core {
      width: 50px;
      height: 50px;
      background: linear-gradient(135deg, var(--primary), var(--success));
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 20px var(--primary);
      z-index: 2;
      transition: all 0.3s ease;
      color: white;
    }
    
    @keyframes modern-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    /* Modern AI speaking animation */
    .modern-ai-wrap.speaking .ring-blue {
      animation: modern-spin 2s linear infinite, modern-pulse 1.2s infinite alternate ease-in-out;
    }
    .modern-ai-wrap.speaking .ring-purple {
      animation: modern-spin 3s linear infinite reverse, modern-pulse 1.5s infinite alternate ease-in-out;
    }
    .modern-ai-wrap.speaking .ring-pink {
      animation: modern-spin 1.5s linear infinite, modern-pulse 0.8s infinite alternate ease-in-out;
    }
    .modern-ai-wrap.speaking .modern-core {
      background: linear-gradient(135deg, var(--primary), var(--primary-hover));
      transform: scale(1.1);
      box-shadow: 0 0 30px var(--primary);
    }
    
    @keyframes modern-pulse {
      0% { transform: scale(0.85) rotate(0deg); }
      100% { transform: scale(1.15) rotate(360deg); }
    }
    
    /* Modern AI thinking animation */
    .modern-ai-wrap.thinking .ring-blue {
      animation-duration: 1s;
    }
    .modern-ai-wrap.thinking .ring-purple {
      animation-duration: 1.5s;
    }
    .modern-ai-wrap.thinking .ring-pink {
      animation-duration: 0.8s;
    }
    .modern-ai-wrap.thinking .modern-core {
      animation: modern-pulse-glow 1.2s infinite alternate ease-in-out;
    }
    
    @keyframes modern-pulse-glow {
      0% { opacity: 0.7; transform: scale(0.95); }
      100% { opacity: 1; transform: scale(1.05); }
    }

    /* Jellyfish Mascot Style */
    .jelly-wrap {
      position: relative;
      width: 160px;
      height: 160px;
      display: none;
      align-items: center;
      justify-content: center;
      animation: jelly-float 3s infinite alternate ease-in-out;
      cursor: pointer;
    }
    
    @keyframes jelly-float {
      0% { transform: translateY(5px); }
      100% { transform: translateY(-10px); }
    }
    
    .jelly-bot {
      position: relative;
      width: 100px;
      height: 130px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    
    .jelly-head {
      width: 76px;
      height: 60px;
      background: radial-gradient(circle at 30% 30%, rgba(0, 242, 254, 0.15) 0%, rgba(79, 172, 254, 0.4) 100%);
      border: 2px solid rgba(0, 242, 254, 0.6);
      border-radius: 40px 40px 15px 15px;
      box-shadow: 0 0 20px rgba(0, 242, 254, 0.4), inset 0 0 10px rgba(0, 242, 254, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 3;
      transition: all 0.3s ease;
    }
    
    .jelly-eyes {
      display: flex;
      gap: 12px;
    }
    
    .jelly-head .eye {
      width: 14px;
      height: 14px;
      background: rgba(15, 12, 11, 0.6);
      border: 1px solid rgba(0, 242, 254, 0.5);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .jelly-head .pupil {
      width: 6px;
      height: 6px;
      background: #00f2fe;
      border-radius: 50%;
      box-shadow: 0 0 6px #00f2fe;
      animation: eye-blink 3.5s infinite alternate ease-in-out;
    }
    
    .jelly-tentacles {
      display: flex;
      justify-content: space-around;
      width: 60px;
      height: 50px;
      margin-top: -4px;
      z-index: 2;
    }
    
    .tentacle {
      width: 4px;
      height: 35px;
      background: linear-gradient(to bottom, rgba(0, 242, 254, 0.6), rgba(79, 172, 254, 0.1));
      border-radius: 2px;
      transform-origin: top center;
      animation: jelly-wiggle 1.5s infinite alternate ease-in-out;
    }
    
    .tentacle:nth-child(1) { animation-delay: 0s; height: 35px; }
    .tentacle:nth-child(2) { animation-delay: 0.2s; height: 45px; }
    .tentacle:nth-child(3) { animation-delay: 0.1s; height: 42px; }
    .tentacle:nth-child(4) { animation-delay: 0.3s; height: 38px; }
    
    @keyframes jelly-wiggle {
      0% { transform: rotate(-5deg) scaleY(1); }
      100% { transform: rotate(10deg) scaleY(0.9); }
    }
    
    /* Jellyfish Speaking State */
    .jelly-wrap.speaking .jelly-head {
      background: radial-gradient(circle at 30% 30%, rgba(255, 75, 75, 0.15) 0%, rgba(255, 114, 114, 0.45) 100%);
      border-color: rgba(255, 75, 75, 0.8);
      box-shadow: 0 0 25px rgba(255, 75, 75, 0.6), inset 0 0 12px rgba(255, 75, 75, 0.3);
    }
    
    .jelly-wrap.speaking .pupil {
      background: #ff4b4b;
      box-shadow: 0 0 8px #ff4b4b;
    }
    
    .jelly-wrap.speaking .tentacle {
      background: linear-gradient(to bottom, rgba(255, 75, 75, 0.8), rgba(255, 114, 114, 0.1));
      animation: jelly-wiggle-fast 0.4s infinite alternate ease-in-out;
    }
    
    @keyframes jelly-wiggle-fast {
      0% { transform: rotate(-15deg) scaleY(1.1); }
      100% { transform: rotate(20deg) scaleY(0.8); }
    }
    
    /* Jellyfish Thinking State */
    .jelly-wrap.thinking .jelly-head {
      background: radial-gradient(circle at 30% 30%, rgba(107, 142, 78, 0.15) 0%, rgba(107, 142, 78, 0.45) 100%);
      border-color: rgba(107, 142, 78, 0.8);
      box-shadow: 0 0 25px rgba(107, 142, 78, 0.6), inset 0 0 12px rgba(107, 142, 78, 0.3);
    }
    
    .jelly-wrap.thinking .pupil {
      background: #6bae4e;
      box-shadow: 0 0 8px #6bae4e;
    }
    
    .jelly-wrap.thinking .tentacle {
      background: linear-gradient(to bottom, rgba(107, 142, 78, 0.7), rgba(107, 142, 78, 0.1));
      animation: jelly-wiggle-slow 2.5s infinite alternate ease-in-out;
    }
    
    @keyframes jelly-wiggle-slow {
      0% { transform: rotate(-2deg) scaleY(0.95); }
      100% { transform: rotate(4deg) scaleY(1.02); }
    }
  </style>
</head>
<body class="dark">
  <div class="grid-bg"></div>
  <div class="glow-blob-1"></div>
  <div class="glow-blob-2"></div>
  
  <div class="tech-coords">
    SYS_STATUS: ONLINE<br>
    NODE: CONNECTED<br>
    CODEC: LINEAR16_8K<br>
    COORD: 10.7769° N, 106.7009° E
  </div>

  <header>
    <div class="logo-container">
      <span class="logo">TH PropTech</span>
      <span class="badge">AI Assistant</span>
    </div>
    
    <div style="display: flex; gap: 8px;">
      <button class="theme-toggle" id="toggle-chat-btn" title="Hiện/Ẩn bản ghi hội thoại" style="display: flex; align-items: center; justify-content: center;">
        <!-- Chat Icon SVG -->
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      <button class="theme-toggle" id="avatar-style-btn" title="Đổi giao diện Trợ lý (Mascot/Quả cầu)" style="display: flex; align-items: center; justify-content: center;">
        <!-- Bot Icon SVG -->
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" y1="16" x2="8" y2="16" />
          <line x1="16" y1="16" x2="16" y2="16" />
        </svg>
      </button>
      
      <button class="theme-toggle" id="theme-btn">
        <!-- Sun Icon SVG -->
        <svg id="sun-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: block;">
          <circle cx="12" cy="12" r="5" fill="none"/>
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
        <!-- Moon Icon SVG -->
        <svg id="moon-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: none;">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>
    </div>
  </header>

  <main>
    <div class="dashboard-grid">
      <!-- Visualizer Card -->
      <div class="card visualizer-card">
        <div class="status-indicator">
          <span class="status-dot" id="status-dot"></span>
          <span id="connection-status">Chưa kết nối</span>
        </div>
        
        <div class="orb-wrapper" id="orb-container">
          <div class="outer-orb" id="outer-orb"></div>
          <div class="inner-orb" id="ai-orb">
            <!-- Mic Icon SVG (Idle state) -->
            <svg id="mic-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display: block;">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
            </svg>
            <!-- Soundwave bars (Speaking state) -->
            <div class="wave-bars" id="wave-bars">
              <span class="wave-bar"></span>
              <span class="wave-bar"></span>
              <span class="wave-bar"></span>
              <span class="wave-bar"></span>
              <span class="wave-bar"></span>
            </div>
          </div>

          <!-- Alien Futuristic Bot -->
          <div class="alien-bot-wrap" id="alienBotWrap">
            <div class="alien-bot">
              <div class="alien-antenna">
                <div class="antenna-glow"></div>
              </div>
              <div class="alien-head">
                <div class="alien-ears"></div>
                <div class="alien-eyes">
                  <div class="eye eye-left"><div class="pupil"></div></div>
                  <div class="eye eye-right"><div class="pupil"></div></div>
                </div>
                <div class="alien-mouth">
                  <div class="mouth-bar"></div>
                  <div class="mouth-bar"></div>
                  <div class="mouth-bar"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Modern AI Assistant -->
          <div class="modern-ai-wrap" id="modernAiWrap">
            <div class="modern-ai-rings">
              <div class="modern-ring ring-blue"></div>
              <div class="modern-ring ring-purple"></div>
              <div class="modern-ring ring-pink"></div>
              <div class="modern-core">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                  <path d="M12 6v12" />
                  <path d="M8 10h8" />
                </svg>
              </div>
            </div>
          </div>

          <!-- Jellyfish Mascot -->
          <div class="jelly-wrap" id="jellyWrap">
            <div class="jelly-bot">
              <div class="jelly-head">
                <div class="jelly-eyes">
                  <div class="eye eye-left"><div class="pupil"></div></div>
                  <div class="eye eye-right"><div class="pupil"></div></div>
                </div>
              </div>
              <div class="jelly-tentacles">
                <div class="tentacle"></div>
                <div class="tentacle"></div>
                <div class="tentacle"></div>
                <div class="tentacle"></div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="status-text-detail" id="status-text">Đang kết nối phiên...</div>
        <div class="status-desc">Trợ lý hỗ trợ đàm thoại đa ngôn ngữ và phân tích tự động nhu cầu thuê căn hộ.</div>
        
        <div class="btn-group">
          <button class="btn btn-primary" id="mic-btn" disabled>
            <!-- Mic SVG -->
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
            </svg>
            Bật Microphone
          </button>
        </div>
      </div>
      
      <!-- Chat Card -->
      <div class="card chat-card">
        <div class="chat-header">
          <h3>Bản ghi hội thoại</h3>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-family: monospace; font-size: 10px; opacity: 0.6;">LOG_ID: ${logId}</span>
            <button type="button" id="collapse-chat-btn" title="Thu gọn bản ghi" style="background: transparent; border: none; color: var(--muted); cursor: pointer; display: flex; align-items: center; transition: color 0.2s;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        
        <div class="chat-log" id="chat-log">
          <!-- Messages will be appended here -->
        </div>
        
        <form class="chat-form" id="chat-form">
          <input type="text" class="chat-input" id="chat-input" placeholder="Nhập tin nhắn..." disabled>
          <button type="submit" class="send-btn" id="send-btn" disabled>
            <!-- Send SVG -->
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
  </main>

  <!-- Completed Screen Overlay -->
  <div class="completed-overlay" id="completed-overlay">
    <div class="completed-modal">
      <div class="completed-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      </div>
      <h2 class="completed-title">Tư vấn hoàn tất</h2>
      <p class="completed-desc">Trợ lý AI đã ghi nhận nhu cầu của bạn và hoàn tất buổi tư vấn!</p>
      
      <div class="completed-action-box">
        <a href="http://localhost:3000/properties" class="completed-btn-primary">
          <!-- Home SVG -->
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          Xem danh sách căn hộ
        </a>
        <a href="http://localhost:3000/" class="completed-btn-secondary">
          Quay về Trang chủ
        </a>
      </div>
      <p class="completed-countdown" id="countdown-txt">Trang sẽ tự động chuyển hướng sau 5 giây...</p>
    </div>
  </div>

  <script>
    const logId = "${logId}";
    
    // Collapse/Expand chat panel toggle
    const toggleChatBtn = document.getElementById('toggle-chat-btn');
    const collapseChatBtn = document.getElementById('collapse-chat-btn');
    const dashboardGrid = document.querySelector('.dashboard-grid');
    
    if (toggleChatBtn) {
      toggleChatBtn.addEventListener('click', () => {
        dashboardGrid.classList.toggle('chat-collapsed');
      });
    }
    if (collapseChatBtn) {
      collapseChatBtn.addEventListener('click', () => {
        dashboardGrid.classList.add('chat-collapsed');
      });
    }
    
    // Theme toggle
    const themeBtn = document.getElementById('theme-btn');
    const sunIcon = document.getElementById('sun-icon');
    const moonIcon = document.getElementById('moon-icon');
    
    themeBtn.addEventListener('click', () => {
      document.body.classList.toggle('dark');
      const isDark = document.body.classList.contains('dark');
      if (isDark) {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      } else {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      }
    });

    // Avatar Style Toggle
    const avatarStyleBtn = document.getElementById('avatar-style-btn');
    const alienBotWrap = document.getElementById('alienBotWrap');
    const modernAiWrap = document.getElementById('modernAiWrap');
    const jellyWrap = document.getElementById('jellyWrap');
    const aiOrb = document.getElementById('ai-orb');
    const outerOrb = document.getElementById('outer-orb');
    let avatarStyle = 'orb';

    function updateAvatarDisplay() {
      const orbContainer = document.getElementById('orb-container');
      if (avatarStyle === 'orb') {
        aiOrb.style.display = 'flex';
        outerOrb.style.display = 'block';
        alienBotWrap.style.display = 'none';
        modernAiWrap.style.display = 'none';
        jellyWrap.style.display = 'none';
      } else if (avatarStyle === 'alien') {
        aiOrb.style.display = 'none';
        outerOrb.style.display = 'none';
        alienBotWrap.style.display = 'flex';
        modernAiWrap.style.display = 'none';
        jellyWrap.style.display = 'none';
      } else if (avatarStyle === 'modern') {
        aiOrb.style.display = 'none';
        outerOrb.style.display = 'none';
        alienBotWrap.style.display = 'none';
        modernAiWrap.style.display = 'flex';
        jellyWrap.style.display = 'none';
      } else if (avatarStyle === 'jellyfish') {
        aiOrb.style.display = 'none';
        outerOrb.style.display = 'none';
        alienBotWrap.style.display = 'none';
        modernAiWrap.style.display = 'none';
        jellyWrap.style.display = 'flex';
      }
    }

    avatarStyleBtn.addEventListener('click', () => {
      if (avatarStyle === 'orb') {
        avatarStyle = 'alien';
      } else if (avatarStyle === 'alien') {
        avatarStyle = 'modern';
      } else if (avatarStyle === 'modern') {
        avatarStyle = 'jellyfish';
      } else {
        avatarStyle = 'orb';
      }
      updateAvatarDisplay();
    });

    updateAvatarDisplay();

    // Audio & Socket processing
    let socket = null;
    let audioContext = null;
    let mediaStream = null;
    let processor = null;
    let isMicActive = false;
    let audioQueue = [];
    let isPlaying = false;
    let aiSpeaking = false;
    let sessionCompletedPending = false;
    
    const chatLog = document.getElementById('chat-log');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const micBtn = document.getElementById('mic-btn');
    const statusText = document.getElementById('status-text');
    const connectionStatus = document.getElementById('connection-status');
    const statusDot = document.getElementById('status-dot');
    const micIcon = document.getElementById('mic-icon');
    const waveBars = document.getElementById('wave-bars');

    function addMessage(sender, text) {
      const bubble = document.createElement('div');
      bubble.classList.add('message-bubble', sender);
      bubble.innerText = text;
      chatLog.appendChild(bubble);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    function setUIState(state) {
      aiOrb.className = 'inner-orb';
      outerOrb.className = 'outer-orb';
      alienBotWrap.className = 'alien-bot-wrap';
      modernAiWrap.className = 'modern-ai-wrap';
      jellyWrap.className = 'jelly-wrap';
      
      if (state === 'speaking') {
        aiSpeaking = true;
        micIcon.style.display = 'none';
        waveBars.style.display = 'flex';
        statusText.innerText = 'AI đang phản hồi...';
        
        aiOrb.classList.add('speaking');
        outerOrb.classList.add('speaking');
        alienBotWrap.classList.add('speaking');
        modernAiWrap.classList.add('speaking');
        jellyWrap.classList.add('speaking');
      } else if (state === 'thinking') {
        micIcon.style.display = 'none';
        waveBars.style.display = 'none';
        statusText.innerText = 'AI đang suy nghĩ...';
        
        aiOrb.classList.add('thinking');
        outerOrb.classList.add('thinking');
        alienBotWrap.classList.add('thinking');
        modernAiWrap.classList.add('thinking');
        jellyWrap.classList.add('thinking');
      } else if (state === 'listening') {
        aiSpeaking = false;
        micIcon.style.display = 'block';
        waveBars.style.display = 'none';
        statusText.innerText = 'Hãy nói nhu cầu của bạn...';
      } else if (state === 'ready') {
        aiSpeaking = false;
        micIcon.style.display = 'block';
        waveBars.style.display = 'none';
        if (isMicActive) {
          statusText.innerText = 'Hãy nói nhu cầu của bạn...';
        } else {
          statusText.innerText = 'Nhấn nút Microphone bên dưới để nói';
        }
      }
    }

    function setAiSpeaking(speaking) {
      if (speaking) {
        setUIState('speaking');
      } else {
        setUIState('ready');
      }
    }

    function playNextAudio() {
      if (audioQueue.length === 0) {
        isPlaying = false;
        setAiSpeaking(false);
        if (sessionCompletedPending) {
          setTimeout(() => {
            showCompletedScreen();
          }, 1000);
        }
        return;
      }
      isPlaying = true;
      setAiSpeaking(true);
      const base64Data = audioQueue.shift();
      try {
        const binaryString = window.atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        
        // Speed up the voice slightly and ensure it is female (default for Google Translate vi)
        audio.defaultPlaybackRate = 1.15;
        audio.playbackRate = 1.15;
        
        audio.onended = () => {
          URL.revokeObjectURL(url);
          playNextAudio();
        };
        audio.play().catch(err => {
          console.error(err);
          playNextAudio();
        });
      } catch (err) {
        console.error(err);
        playNextAudio();
      }
    }

    function queueAudio(base64Data) {
      audioQueue.push(base64Data);
      if (!isPlaying) {
        playNextAudio();
      }
    }

    function showCompletedScreen() {
      stopMicrophone();
      const overlay = document.getElementById('completed-overlay');
      overlay.classList.add('show');
      
      let seconds = 5;
      const countdownTxt = document.getElementById('countdown-txt');
      
      const interval = setInterval(() => {
        seconds--;
        if (seconds <= 0) {
          clearInterval(interval);
          window.location.href = "http://localhost:3000/properties";
        } else {
          countdownTxt.innerText = "Trang sẽ tự động chuyển hướng sau " + seconds + " giây...";
        }
      }, 1000);
    }

    // Connect WebSocket
    function connect() {
      const loc = window.location;
      const wsProtocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = wsProtocol + '//' + loc.host + '/ws/ai-consultation?logId=' + logId;
      
      socket = new WebSocket(wsUrl);
      
      socket.onopen = () => {
        connectionStatus.innerText = 'Sẵn sàng đàm thoại';
        statusDot.classList.add('active');
        statusText.innerText = 'Nhấn nút Microphone bên dưới để nói';
        micBtn.disabled = false;
        chatInput.disabled = false;
        sendBtn.disabled = false;
      };
      
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.event === 'text_reply' && payload.text) {
            const rawText = payload.text;
            if (rawText.startsWith('Khách hàng: ')) {
              addMessage('user', rawText.replace('Khách hàng: ', ''));
            } else {
              addMessage('assistant', rawText);
            }
          }
          if (payload.event === 'thinking') {
            setUIState('thinking');
            aiSpeaking = true;
          }
          if (payload.event === 'thinking_failed') {
            setAiSpeaking(false);
          }
          if (payload.event === 'chunk' && payload.media?.payload) {
            queueAudio(payload.media.payload);
          }
          if (payload.event === 'session_completed') {
            sessionCompletedPending = true;
            if (!isPlaying && audioQueue.length === 0) {
              showCompletedScreen();
            }
          }
        } catch (err) {
          console.error(err);
        }
      };
      
      socket.onerror = (err) => {
        console.error(err);
        statusText.innerText = 'Lỗi kết nối đàm thoại.';
      };
      
      socket.onclose = () => {
        connectionStatus.innerText = 'Chưa kết nối';
        statusDot.classList.remove('active');
        statusText.innerText = 'Phiên đàm thoại kết thúc.';
        micBtn.disabled = true;
        chatInput.disabled = true;
        sendBtn.disabled = true;
        stopMicrophone();
      };
    }

    function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
      if (inputSampleRate === outputSampleRate) {
        return buffer;
      }
      const sampleRateRatio = inputSampleRate / outputSampleRate;
      const newLength = Math.round(buffer.length / sampleRateRatio);
      const result = new Float32Array(newLength);
      let offsetResult = 0;
      let offsetBuffer = 0;
      while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        let accum = 0;
        let count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
          accum += buffer[i];
          count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
      }
      return result;
    }

    function convertFloat32ToInt16(buffer) {
      let l = buffer.length;
      const buf = new Int16Array(l);
      while (l--) {
        const s = Math.max(-1, Math.min(1, buffer[l]));
        buf[l] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return buf.buffer;
    }

    async function startMicrophone() {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioCtx({ sampleRate: 8000 });
        
        const source = audioContext.createMediaStreamSource(mediaStream);
        processor = audioContext.createScriptProcessor(2048, 1, 1);
        
        processor.onaudioprocess = (e) => {
          if (aiSpeaking) return;
          
          const inputData = e.inputBuffer.getChannelData(0);
          const inputSampleRate = audioContext.sampleRate;
          const downsampledData = downsampleBuffer(inputData, inputSampleRate, 8000);
          const int16Buffer = convertFloat32ToInt16(downsampledData);
          const base64Payload = btoa(
            String.fromCharCode(...new Uint8Array(int16Buffer))
          );
          
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              event: 'media',
              data: { media: { payload: base64Payload } }
            }));
          }
        };
        
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        isMicActive = true;
        aiOrb.classList.add('active');
        outerOrb.classList.add('active');
        micBtn.innerHTML = \`
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 11a6.97 6.97 0 0 1-1.3 3.88M12 19v4M8 23h8" />
          </svg>
          Tắt Microphone
        \`;
        statusText.innerText = 'Hãy nói nhu cầu của bạn...';
      } catch (err) {
        console.error(err);
        alert('Không thể mở microphone. Vui lòng cấp quyền.');
      }
    }

    function stopMicrophone() {
      if (processor) {
        processor.disconnect();
        processor = null;
      }
      if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
      }
      isMicActive = false;
      aiOrb.classList.remove('active');
      outerOrb.classList.remove('active');
      micBtn.innerHTML = \`
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
        </svg>
        Bật Microphone
      \`;
      if (socket && socket.readyState === WebSocket.OPEN && !aiSpeaking) {
        statusText.innerText = 'Nhấn nút Microphone bên dưới để nói';
      }
    }

    micBtn.addEventListener('click', async () => {
      if (isMicActive) {
        stopMicrophone();
      } else {
        await startMicrophone();
      }
    });

    const chatForm = document.getElementById('chat-form');
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
      
      socket.send(JSON.stringify({
        event: 'test_text',
        data: { text: text }
      }));
      chatInput.value = '';
      setUIState('thinking');
      aiSpeaking = true;
    });

    connect();
  </script>
</body>
</html>
  `
}
