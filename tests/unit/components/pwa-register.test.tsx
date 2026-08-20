import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PwaRegister } from "@/components/pwa/pwa-register";

const DISMISSED_KEY = "umsuka.pwa.install.dismissed";

// jsdom does not implement window.matchMedia; the component reads it to
// detect already-installed standalone mode.
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      media: "(display-mode: standalone)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
}

beforeEach(() => {
  stubMatchMedia(false);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface InstallPromptOverrides {
  prompt?: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  preventDefault?: () => void;
}

function createInstallPromptEvent(overrides: InstallPromptOverrides = {}): Event {
  const event = new Event("beforeinstallprompt");
  Object.defineProperty(event, "preventDefault", {
    value: overrides.preventDefault ?? vi.fn(),
    writable: true,
  });
  Object.defineProperty(event, "prompt", {
    value: overrides.prompt ?? vi.fn().mockResolvedValue(undefined),
    writable: true,
  });
  Object.defineProperty(event, "userChoice", {
    value:
      overrides.userChoice ??
      Promise.resolve({ outcome: "accepted", platform: "web" }),
    writable: true,
  });
  return event;
}

function fireInstallPrompt(event: Event = createInstallPromptEvent()): void {
  act(() => {
    window.dispatchEvent(event);
  });
}

describe("PwaRegister", () => {
  it("no muestra el banner antes de beforeinstallprompt", () => {
    render(<PwaRegister />);

    expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument();
    expect(screen.queryByText("Instala la app de Umsuka Imbali")).not.toBeInTheDocument();
  });

  it("muestra el banner al recibir beforeinstallprompt y previene el gesto nativo", async () => {
    render(<PwaRegister />);
    const preventDefault = vi.fn();
    fireInstallPrompt(createInstallPromptEvent({ preventDefault }));

    expect(await screen.findByRole("button", { name: "Instalar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No, gracias" })).toBeInTheDocument();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("oculta el banner al instalar (userChoice accepted)", async () => {
    const user = userEvent.setup();
    const prompt = vi.fn().mockResolvedValue(undefined);
    render(<PwaRegister />);
    fireInstallPrompt(createInstallPromptEvent({ prompt }));

    await user.click(await screen.findByRole("button", { name: "Instalar" }));

    expect(prompt).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument(),
    );
  });

  it("mantiene el banner si el usuario descarta el diálogo del navegador", async () => {
    const user = userEvent.setup();
    render(<PwaRegister />);
    fireInstallPrompt(
      createInstallPromptEvent({
        userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
      }),
    );

    await user.click(await screen.findByRole("button", { name: "Instalar" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Instalar" })).toBeInTheDocument(),
    );
  });

  it("persiste el rechazo en localStorage y oculta el banner al pulsar 'No, gracias'", async () => {
    const user = userEvent.setup();
    render(<PwaRegister />);
    fireInstallPrompt();

    await user.click(await screen.findByRole("button", { name: "No, gracias" }));

    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe("true");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument(),
    );
  });

  it("no vuelve a mostrar el banner una vez rechazado", () => {
    window.localStorage.setItem(DISMISSED_KEY, "true");
    render(<PwaRegister />);

    fireInstallPrompt();

    expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument();
  });

  it("oculta el banner al recibir appinstalled", async () => {
    render(<PwaRegister />);
    fireInstallPrompt();
    expect(await screen.findByRole("button", { name: "Instalar" })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument(),
    );
  });

  it("no muestra el banner si la app ya corre en modo standalone", async () => {
    stubMatchMedia(true);
    render(<PwaRegister />);

    fireInstallPrompt();

    expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument();
  });
});