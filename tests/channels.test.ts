import { afterEach, describe, expect, it, vi } from "vitest";
import { localDevUser } from "#lib/local-dev-user.js";

vi.mock("@vercel/connect/eve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/connect/eve")>();
  return {
    ...actual,
    connectSlackCredentials: vi.fn(actual.connectSlackCredentials),
  };
});

const LOCAL_URL = "http://localhost:3000/eve/v1/session";

/**
 * Mark the process as an `eve dev` server, which is what `localDev()` checks.
 */
const asDevServer = (): void => {
  vi.stubEnv("EVE_DEV", "1");
};

afterEach(() => {
  vi.resetModules();
});

describe("localDevUser", () => {
  it("admits a loopback caller on a dev server as a user who may read agent info", async () => {
    asDevServer();

    const caller = await localDevUser(new Request(LOCAL_URL));

    expect(caller).toMatchObject({
      allowAgentInfo: true,
      authenticator: "local-dev",
      principalType: "user",
    });
    expect(caller?.principalId).toEqual(expect.any(String));
  });

  it.each([
    "http://localhost:3000/eve/v1/session",
    "http://127.0.0.1:4274/eve/v1/info",
    "http://[::1]:3000/eve/v1/session",
  ])("treats %s as local", async (url) => {
    asDevServer();
    expect(await localDevUser(new Request(url))).not.toBeNull();
  });

  it("admits nobody outside a dev server, even from loopback", async () => {
    expect(await localDevUser(new Request(LOCAL_URL))).toBeNull();
  });

  it("admits nobody on a Vercel production deployment", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await localDevUser(new Request(LOCAL_URL))).toBeNull();
  });

  it("refuses a request a browser sent on behalf of another site", async () => {
    asDevServer();
    const request = new Request(LOCAL_URL, {
      headers: { origin: "https://evil.example" },
      method: "POST",
    });
    expect(await localDevUser(request)).toBeNull();
  });

  it("refuses a request addressed to a host that isn't this machine", async () => {
    asDevServer();
    expect(
      await localDevUser(new Request("http://agent.example.com/eve/v1/session"))
    ).toBeNull();
  });
});

describe("eve channel", () => {
  it("serves the session API", async () => {
    const { default: channel } = await import("../agent/channels/eve.js");
    const routes = channel.routes.map(
      (route) => `${route.method} ${route.path}`
    );
    expect(routes).toContain("POST /eve/v1/session");
    expect(routes).toContain("GET /eve/v1/health");
  });
});

describe("slack channel", () => {
  /**
   * Import the Slack channel fresh, under a chosen `SLACK_CONNECTOR` setting.
   *
   * @remarks
   * Resetting the module registry also re-creates the mocked connector module, so each test
   * imports the helper again to read the calls its own channel import made.
   *
   * @param connector - The value for `SLACK_CONNECTOR`, or `undefined` to leave it unset.
   * @returns The channel's routes, as `METHOD path` strings.
   */
  const loadSlack = async (connector?: string): Promise<string[]> => {
    vi.resetModules();
    vi.stubEnv("SLACK_CONNECTOR", connector);
    const { default: channel } = await import("../agent/channels/slack.js");
    return channel.routes.map((route) => `${route.method} ${route.path}`);
  };

  it("takes credentials from the default Vercel Connect connector", async () => {
    const routes = await loadSlack();

    const { connectSlackCredentials } = await import("@vercel/connect/eve");
    expect(vi.isMockFunction(connectSlackCredentials)).toBe(true);
    expect(connectSlackCredentials).toHaveBeenCalledExactlyOnceWith(
      "slack/eve-content-agent"
    );
    expect(routes).toEqual(["POST /eve/v1/slack"]);
  });

  it("reads the connector UID from SLACK_CONNECTOR when set", async () => {
    await loadSlack("slack/team-bot");

    const { connectSlackCredentials } = await import("@vercel/connect/eve");
    expect(connectSlackCredentials).toHaveBeenCalledExactlyOnceWith(
      "slack/team-bot"
    );
  });
});
