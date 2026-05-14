import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { tool } from "@opencode-ai/plugin";

const LOCK_ROOT = join(realpathSync.native(os.tmpdir()), "opencode-caffeinate");
const LOCK_FILENAME = "opencode_caffeinate.lock";
const EXIT_WAIT_MS = 1500;
const KILL_WAIT_MS = 700;
const AUTO_START_ENV_VAR = "OPENCODE_CAFFEINATE_AUTO";
const AUTO_START_DISABLED_VALUES = new Set([
  "0",
  "false",
  "off",
  "no",
  "disabled",
]);

const STATUS_UNSUPPORTED_LINES = [
  "Power status: this machine has decaf mode enabled (non-macOS), so caffeinate is off duty.",
  "Power status: no espresso shots today - caffeinate only works on macOS.",
  "Power status: the coffee machine is unplugged on this platform.",
];

const STATUS_RUNNING_LINES = [
  (pid) =>
    `Power status: coffee IV connected. Caffeinate is buzzing (pid ${pid}).`,
  (pid) =>
    `Power status: full bean overload. Caffeinate is sprinting laps (pid ${pid}).`,
  (pid) =>
    `Power status: jitter protocol engaged. Caffeinate is wide awake (pid ${pid}).`,
  (pid) =>
    `Power status: triple shot deployed. Caffeinate has the wheel (pid ${pid}).`,
];

const STATUS_STOPPED_LINES = [
  "Power status: mug is empty. Caffeinate is not running for this session.",
  "Power status: barista break. No caffeinate process is active right now.",
  "Power status: decaf interval active. Caffeinate is currently off.",
  "Power status: espresso reserves depleted. Caffeinate is not running.",
];

const START_UNSUPPORTED_LINES = [
  "My coffee addiction only works on macOS. I cannot start caffeinate here.",
  "No macOS, no mocha: caffeinate cannot be started on this platform.",
  "I reached for coffee, but this platform only serves decaf.",
];

const ALREADY_RUNNING_CRASH_OUT_LINES = [
  (pid) =>
    `I am already overcaffeinated (pid ${pid}). Please run crash_out before another cup.`,
  (pid) =>
    `Still sipping from the same espresso (pid ${pid}). Run crash_out first.`,
  (pid) =>
    `Coffee levels are maxed out already (pid ${pid}). Hit crash_out before refilling.`,
];

const ALREADY_RUNNING_AUTO_LINES = [
  (pid) =>
    `Auto mode check-in: caffeine stream is already flowing (pid ${pid}).`,
  (pid) => `Auto mode says we are already buzzing (pid ${pid}).`,
  (pid) => `No refill needed, coffee engine is active (pid ${pid}).`,
];

const START_FAILED_LINES = [
  (reason) => `Tried to brew coffee, but the machine jammed: ${reason}`,
  (reason) => `Espresso launch failed: ${reason}`,
  (reason) => `The barista tripped over the power cord: ${reason}`,
];

const START_NO_PID_LINES = [
  "Coffee machine started making noises but never gave me a receipt (missing pid).",
  "Brew attempt returned no pid, so I am not trusting that cup.",
  "The espresso came out imaginary (no pid returned).",
];

const STARTED_LINES = [
  (pid) =>
    `Brewed and injected pure espresso. Caffeinate is live (pid ${pid}).`,
  (pid) => `Coffee protocol online. Caffeinate is now running (pid ${pid}).`,
  (pid) =>
    `Fresh roast activated. Display-sleep ban is in effect (pid ${pid}).`,
];

const STOP_UNSUPPORTED_LINES = [
  "Nothing to crash out here; this platform is already living the decaf life.",
  "No caffeinate process to stop on this platform's menu.",
  "Decaf by design here, so there is nothing to power down.",
];

const STOP_NOT_RUNNING_LINES = [
  "No active coffee drip found for this session.",
  "The mug is already empty. Nothing to crash_out.",
  "No jitter detected; caffeinate is already stopped.",
];

const STOPPED_LINES = [
  (pid) => `Coffee crash complete. Caffeinate has clocked out (pid ${pid}).`,
  (pid) => `I dumped the espresso shot. Caffeinate stopped (pid ${pid}).`,
  (pid) => `Nap mode restored. Caffeinate was escorted out (pid ${pid}).`,
];

const sessionProcesses = new Map();
const sessionQueues = new Map();

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomLine(lines) {
  return pickRandom(lines);
}

function randomLineWithArg(lines, value) {
  return pickRandom(lines)(value);
}

function sessionKey(sessionID) {
  return encodeURIComponent(sessionID);
}

function lockDir(sessionID) {
  return join(LOCK_ROOT, sessionKey(sessionID));
}

function lockPath(sessionID) {
  return join(lockDir(sessionID), LOCK_FILENAME);
}

function withSessionQueue(sessionID, task) {
  const previous = sessionQueues.get(sessionID) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => gate);
  sessionQueues.set(sessionID, chain);

  return previous.then(task).finally(() => {
    release();
    if (sessionQueues.get(sessionID) === chain) {
      sessionQueues.delete(sessionID);
    }
  });
}

function parseLock(content) {
  const [version, pidRaw, startedAtRaw, sessionID, ownerPidRaw] = content
    .trim()
    .split("|");
  if (version !== "v1") return null;

  const pid = Number(pidRaw);
  const startedAt = Number(startedAtRaw);
  const ownerPid = ownerPidRaw === undefined ? undefined : Number(ownerPidRaw);

  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
  if (!sessionID) return null;
  if (ownerPid !== undefined && (!Number.isInteger(ownerPid) || ownerPid <= 0))
    return null;

  return {
    pid,
    startedAt,
    sessionID,
    ownerPid,
  };
}

function readLock(sessionID) {
  try {
    const parsed = parseLock(readFileSync(lockPath(sessionID), "utf8"));
    if (parsed) {
      return parsed;
    }

    clearLock(sessionID);
    return null;
  } catch {
    return null;
  }
}

function isLockOwnedByCurrentProcess(lock) {
  if (!lock?.ownerPid) return true;
  return lock.ownerPid === process.pid;
}

function writeLock(sessionID, pid) {
  const record = `v1|${pid}|${Date.now()}|${sessionID}|${process.pid}`;
  const sessionLockDir = lockDir(sessionID);
  const target = lockPath(sessionID);
  const temp = `${target}.tmp`;

  mkdirSync(sessionLockDir, { recursive: true });
  writeFileSync(temp, record, "utf8");
  renameSync(temp, target);
}

function clearLock(sessionID) {
  try {
    rmSync(lockDir(sessionID), { recursive: true, force: true });
  } catch {
    // no-op
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPidExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await sleep(100);
  }
  return !isPidAlive(pid);
}

function getTrackedProcess(sessionID) {
  const proc = sessionProcesses.get(sessionID);
  if (!proc) return null;

  const pid = Number(proc.pid ?? 0);
  if (Number.isInteger(pid) && pid > 0 && isPidAlive(pid)) {
    return proc;
  }

  sessionProcesses.delete(sessionID);
  return null;
}

function getEventSessionID(event) {
  if (
    typeof event?.properties?.sessionID === "string" &&
    event.properties.sessionID.length > 0
  ) {
    return event.properties.sessionID;
  }

  if (typeof event?.sessionID === "string" && event.sessionID.length > 0) {
    return event.sessionID;
  }

  return null;
}

function isAutoStartEnabled() {
  const raw = process.env[AUTO_START_ENV_VAR];
  if (typeof raw !== "string") return true;

  return !AUTO_START_DISABLED_VALUES.has(raw.trim().toLowerCase());
}

function getSessionStatus(sessionID) {
  if (process.platform !== "darwin") {
    return {
      running: false,
      status: "unsupported",
    };
  }

  const tracked = getTrackedProcess(sessionID);
  if (tracked) {
    const pid = Number(tracked.pid ?? 0);
    if (Number.isInteger(pid) && pid > 0) {
      return {
        running: true,
        status: "running",
        pid,
      };
    }
  }

  const lock = readLock(sessionID);
  if (!lock) {
    return {
      running: false,
      status: "stopped",
    };
  }

  if (!isLockOwnedByCurrentProcess(lock)) {
    clearLock(sessionID);
    return {
      running: false,
      status: "stopped",
    };
  }

  if (!isPidAlive(lock.pid)) {
    clearLock(sessionID);
    return {
      running: false,
      status: "stopped",
    };
  }

  return {
    running: true,
    status: "running",
    pid: lock.pid,
  };
}

async function ensureStarted(sessionID, requireCrashOut) {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      message: randomLine(START_UNSUPPORTED_LINES),
    };
  }

  return withSessionQueue(sessionID, async () => {
    const tracked = getTrackedProcess(sessionID);
    if (tracked) {
      const pid = Number(tracked.pid);
      if (requireCrashOut) {
        return {
          ok: false,
          pid,
          message: randomLineWithArg(ALREADY_RUNNING_CRASH_OUT_LINES, pid),
        };
      }

      writeLock(sessionID, pid);
      return {
        ok: true,
        pid,
        message: randomLineWithArg(ALREADY_RUNNING_AUTO_LINES, pid),
      };
    }

    const lock = readLock(sessionID);
    if (lock) {
      if (!isLockOwnedByCurrentProcess(lock)) {
        clearLock(sessionID);
      } else if (isPidAlive(lock.pid)) {
        if (requireCrashOut) {
          return {
            ok: false,
            pid: lock.pid,
            message: randomLineWithArg(
              ALREADY_RUNNING_CRASH_OUT_LINES,
              lock.pid,
            ),
          };
        }

        return {
          ok: true,
          pid: lock.pid,
          message: randomLineWithArg(ALREADY_RUNNING_AUTO_LINES, lock.pid),
        };
      }

      clearLock(sessionID);
    }

    let proc;
    try {
      proc = Bun.spawn(["caffeinate", "-d", "-w", String(process.pid)], {
        detached: true,
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return {
        ok: false,
        message: randomLineWithArg(START_FAILED_LINES, message),
      };
    }

    const pid = Number(proc.pid ?? 0);
    if (!Number.isInteger(pid) || pid <= 0) {
      try {
        proc.kill();
      } catch {
        // no-op
      }

      return {
        ok: false,
        message: randomLine(START_NO_PID_LINES),
      };
    }

    if (typeof proc.unref === "function") {
      try {
        proc.unref();
      } catch {
        // no-op
      }
    }

    sessionProcesses.set(sessionID, proc);
    writeLock(sessionID, pid);

    void proc.exited
      .then(() => {
        const active = sessionProcesses.get(sessionID);
        if (active === proc) {
          sessionProcesses.delete(sessionID);
        }

        const current = readLock(sessionID);
        if (current?.pid === pid) {
          clearLock(sessionID);
        }
      })
      .catch(() => {
        // no-op
      });

    return {
      ok: true,
      pid,
      message: randomLineWithArg(STARTED_LINES, pid),
    };
  });
}

async function ensureStopped(sessionID) {
  if (process.platform !== "darwin") {
    return {
      ok: true,
      message: randomLine(STOP_UNSUPPORTED_LINES),
    };
  }

  return withSessionQueue(sessionID, async () => {
    const tracked = getTrackedProcess(sessionID);
    let pid = Number(tracked?.pid ?? 0);

    if (!Number.isInteger(pid) || pid <= 0) {
      const lock = readLock(sessionID);
      if (lock && !isLockOwnedByCurrentProcess(lock)) {
        clearLock(sessionID);
      } else {
        pid = Number(lock?.pid ?? 0);
      }
    }

    if (!Number.isInteger(pid) || pid <= 0) {
      sessionProcesses.delete(sessionID);
      clearLock(sessionID);
      return {
        ok: true,
        message: randomLine(STOP_NOT_RUNNING_LINES),
      };
    }

    if (isPidAlive(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // no-op
      }

      const didExit = await waitForPidExit(pid, EXIT_WAIT_MS);
      if (!didExit && isPidAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // no-op
        }
        await waitForPidExit(pid, KILL_WAIT_MS);
      }
    }

    sessionProcesses.delete(sessionID);
    clearLock(sessionID);

    return {
      ok: true,
      pid,
      message: randomLineWithArg(STOPPED_LINES, pid),
    };
  });
}

export const CaffeinatePlugin = async () => {
  return {
    "experimental.chat.system.transform": async (input) => {
      const status = getSessionStatus(input.sessionID);
      if (status.status === "unsupported") {
        return [randomLine(STATUS_UNSUPPORTED_LINES)];
      }

      if (status.running) {
        return [randomLineWithArg(STATUS_RUNNING_LINES, status.pid)];
      }

      return [randomLine(STATUS_STOPPED_LINES)];
    },

    tool: {
      caffeinate: tool({
        description:
          "Start caffeinate -d -w <opencode pid> for this session. Requires crash_out before starting again.",
        args: {},
        async execute(_args, context) {
          const result = await ensureStarted(context.sessionID, true);
          context.metadata({
            title: "caffeinate",
            metadata: {
              sessionID: context.sessionID,
              pid: result.pid ?? null,
              ok: result.ok,
            },
          });
          return result.message;
        },
      }),

      crash_out: tool({
        description:
          "Kill the session caffeinate process and remove the lockfile.",
        args: {},
        async execute(_args, context) {
          const result = await ensureStopped(context.sessionID);
          context.metadata({
            title: "crash_out",
            metadata: {
              sessionID: context.sessionID,
              pid: result.pid ?? null,
              ok: result.ok,
            },
          });
          return result.message;
        },
      }),
    },

    event: async ({ event }) => {
      const sessionID = getEventSessionID(event);
      if (!sessionID) return;

      if (event.type === "session.status") {
        const statusType = event?.properties?.status?.type;
        if (statusType === "busy") {
          if (!isAutoStartEnabled()) return;
          await ensureStarted(sessionID, false);
          return;
        }

        if (statusType === "idle") {
          await ensureStopped(sessionID);
          return;
        }
      }

      if (event.type === "session.idle") {
        await ensureStopped(sessionID);
      }
    },
  };
};

export default CaffeinatePlugin;
