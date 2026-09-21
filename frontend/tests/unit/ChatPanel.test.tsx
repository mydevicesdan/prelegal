import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel, GREETING } from "@/components/ChatPanel";
import type { ChatContext } from "@/lib/chat";
import { initialFormState } from "@/lib/nda";
import { chatReply, mockChatApi, ndaReply, requestBody } from "./chatFixtures";

afterEach(() => vi.unstubAllGlobals());

const context: ChatContext = {
  data: { ...initialFormState, effectiveDate: "2026-09-20" },
  documentType: "csa",
  values: { "governing-law": "Delaware" },
  parties: { Provider: { company: "Acme", name: "", title: "", address: "" } },
};

const setup = (onTurn = vi.fn()) => {
  const user = userEvent.setup();
  render(<ChatPanel context={context} onTurn={onTurn} />);
  return { user, onTurn, input: screen.getByLabelText("Message") };
};

const sendButton = () => screen.getByRole("button", { name: "Send" });

describe("ChatPanel", () => {
  it("opens with the assistant's greeting and nothing sent yet", () => {
    const fetchMock = mockChatApi();
    setup();
    expect(screen.getByRole("log")).toHaveTextContent(GREETING);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendButton()).toBeDisabled();
  });

  it("sends the message with the history and shows the reply, then passes the updates on", async () => {
    const fetchMock = mockChatApi(ndaReply("Got it. Which state's law?", { governingLaw: "Ohio" }));
    const { user, input, onTurn } = setup();

    await user.type(input, "Acme and Globex");
    await user.click(sendButton());

    expect(await screen.findByText(/Which state's law\?/)).toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveTextContent("Acme and Globex");
    expect(input).toHaveValue("");
    expect(requestBody(fetchMock).messages).toEqual([
      { role: "assistant", content: GREETING },
      { role: "user", content: "Acme and Globex" },
    ]);
    expect(onTurn).toHaveBeenCalledOnce();
    expect(onTurn.mock.calls[0][0].updates.governingLaw).toBe("Ohio");
  });

  it("keeps the conversation going across turns", async () => {
    const fetchMock = mockChatApi(chatReply("One?"), chatReply("Two?"));
    const { user, input } = setup();

    await user.type(input, "first");
    await user.click(sendButton());
    await screen.findByText("One?");
    await user.type(input, "second");
    await user.click(sendButton());
    await screen.findByText("Two?");

    expect(requestBody(fetchMock, 1).messages.map((m: { content: string }) => m.content)).toEqual([
      GREETING,
      "first",
      "One?",
      "second",
    ]);
  });

  it("sends the current document with each message", async () => {
    const fetchMock = mockChatApi(chatReply("ok"));
    const { user, input } = setup();
    await user.type(input, "hi");
    await user.click(sendButton());
    await screen.findByText("ok");
    const body = requestBody(fetchMock);
    expect(body.fields.effectiveDate).toBe("2026-09-20");
    expect(body.documentType).toBe("csa");
    expect(body.values).toEqual([{ key: "governing-law", value: "Delaware" }]);
    expect(body.parties[0]).toMatchObject({ role: "Provider", company: "Acme" });
  });

  it("passes the whole turn on, including the chosen document and the generic fields", async () => {
    mockChatApi(
      chatReply("A CSA.", {
        documentType: "csa",
        fieldValues: [{ key: "governing-law", value: "Ohio" }],
        parties: [{ role: "Provider", company: "Acme", name: null, title: null, address: null }],
      }),
    );
    const { user, input, onTurn } = setup();
    await user.type(input, "hi");
    await user.click(sendButton());
    await screen.findByText("A CSA.");
    expect(onTurn.mock.calls[0][0]).toMatchObject({
      documentType: "csa",
      fieldValues: [{ key: "governing-law", value: "Ohio" }],
    });
  });

  it("opens by offering the documents it can draft", () => {
    setup();
    expect(screen.getByRole("log")).toHaveTextContent("What do you need?");
  });

  it("sends on Enter but not on Shift+Enter", async () => {
    const fetchMock = mockChatApi(chatReply("ok"));
    const { user, input } = setup();

    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input).toHaveValue("line one\nline two");

    await user.type(input, "{Enter}");
    await screen.findByText("ok");
    expect(requestBody(fetchMock).messages.at(-1).content).toBe("line one\nline two");
  });

  it("does not send when Enter confirms an IME composition", async () => {
    const fetchMock = mockChatApi(chatReply("ok"));
    const { user, input } = setup();
    await user.type(input, "にほん");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input).toHaveValue("にほん");
  });

  it("limits the message length to what the backend accepts", () => {
    setup();
    expect(screen.getByLabelText("Message")).toHaveAttribute("maxlength", "4000");
  });

  it("ignores blank messages", async () => {
    const fetchMock = mockChatApi();
    const { user, input } = setup();
    await user.type(input, "   {Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendButton()).toBeDisabled();
  });

  it("shows a thinking indicator and blocks sending while waiting", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    const { user, input } = setup();

    await user.type(input, "hello");
    await user.click(sendButton());
    expect(screen.getByText("Assistant is thinking…")).toBeInTheDocument();
    await user.type(input, "more");
    expect(sendButton()).toBeDisabled();

    resolve(new Response(JSON.stringify(chatReply("done")), { status: 200 }));
    expect(await screen.findByText("done")).toBeInTheDocument();
    expect(screen.queryByText("Assistant is thinking…")).not.toBeInTheDocument();
  });

  it("shows the error, keeps the user's message, does not apply updates, and retries", async () => {
    const fetchMock = mockChatApi(
      { status: 502, body: { detail: "The AI assistant could not respond. Please try again." } },
      ndaReply("Back again", { governingLaw: "Ohio" }),
    );
    const { user, input, onTurn } = setup();

    await user.type(input, "hello");
    await user.click(sendButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("The AI assistant could not respond.");
    expect(screen.getByRole("log")).toHaveTextContent("hello");
    expect(onTurn).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Back again")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(onTurn).toHaveBeenCalledOnce();
    // The retry re-sent the same history rather than duplicating the user's message.
    expect(requestBody(fetchMock, 1).messages).toEqual(requestBody(fetchMock, 0).messages);
  });

  it("renders message text literally", async () => {
    mockChatApi(chatReply("<img src=x onerror=alert(1)> **bold**"));
    const { user, input } = setup();
    await user.type(input, "hi");
    await user.click(sendButton());
    const log = await screen.findByRole("log");
    await screen.findByText(/<img src=x/);
    expect(log.querySelector("img")).toBeNull();
    expect(log.querySelector("strong")).toBeNull();
  });
});
