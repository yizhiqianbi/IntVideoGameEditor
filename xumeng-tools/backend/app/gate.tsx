"use client";

import { useEffect, useState } from "react";

const ADULT_KEY = "xumeng-gen-18";

export function useAdult() {
  const [ready, setReady] = useState(false);
  const [adult, setAdult] = useState(false);
  const [left, setLeft] = useState(false);

  useEffect(() => {
    setAdult(sessionStorage.getItem(ADULT_KEY) === "1");
    setReady(true);
  }, []);

  return {
    ready,
    adult,
    left,
    enter() {
      sessionStorage.setItem(ADULT_KEY, "1");
      setAdult(true);
    },
    leave() {
      setLeft(true);
    },
  };
}

export function Gate({ enter, leave }: { enter: () => void; leave: () => void }) {
  return <main className="gate">
    <div className="gate-card">
      <h1>这里是成人内容</h1>
      <p>只做二十一岁以上的虚构角色。页面包含成人向的画面模板。</p>
      <button type="button" className="primary" onClick={enter}>我已满 18 岁，继续</button>
      <button type="button" className="leave" onClick={leave}>离开</button>
    </div>
  </main>;
}
