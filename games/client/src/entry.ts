const path = location.pathname.replace(/\/$/, "");
if (path === "/alkkagi") await import("./alkkagi/main");
else if (path === "/othello") await import("./othello/main");
else if (path === "/rummikub") await import("./rummikub/main");
else if (path === "/omok") await import("./omok/main");
else if (path === "/rock-run") await import("./rock-run/main");
else if (path === "/arrow-dodge") await import("./arrow-dodge/main");
else await import("./volleyball/main");
export {};
