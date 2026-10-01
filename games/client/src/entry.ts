const path = location.pathname.replace(/\/$/, "");
if (path === "/omok") await import("./omok/main");
else if (path === "/rock-run") await import("./rock-run/main");
else if (path === "/arrow-dodge") await import("./arrow-dodge/main");
else await import("./volleyball/main");
export {};
