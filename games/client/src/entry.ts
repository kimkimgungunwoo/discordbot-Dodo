if (location.pathname.replace(/\/$/, "") === "/omok") await import("./omok/main");
else await import("./volleyball/main");
export {};
