// The home-screen widget the user chose (mockup A2, "Orb and next"): Blu's orb on dark glass with
// what's next beside it. The orb opens Blu's input (blu://assistant — keyboard up, mic beside
// it); the text opens the Now screen (blu://now). Android widgets are RemoteViews: no animation,
// so the orb is a still frame of the app's shader, with edges faded to full transparency.
//
// Every size is computed from the widget's real dimensions (widgetInfo, in dp) rather than left
// to flex: RemoteViews did not hold a flex:1 text column to the space beside the orb, so a long
// title ran off the right edge, pushed three corners out of view and cut off the last line.
import React from 'react';
import { FlexWidget, ImageWidget, TextWidget } from 'react-native-android-widget';

const ORB = require('../assets/widget-orb.png');

const WHITE = 'rgba(255, 255, 255, 1)';
const LABEL = 'rgba(235, 238, 250, 0.62)';
const SUB = 'rgba(235, 238, 250, 0.74)';
const ACCENT = 'rgba(130, 169, 255, 1)';
const PAD = 14;
const GAP = 10;

function content(s) {
  if (s.state === 'signedOut') return { heading: 'Blu', title: 'Sign in to see what’s next', sub: 'Open the app once to connect' };
  if (s.state === 'loading') return { heading: 'Blu', title: 'Loading…', sub: '' };
  if (s.next) return { heading: s.next.label, title: s.next.title, sub: s.next.sub };
  return { heading: 'Today', title: 'Nothing open.', sub: 'Tap the orb to tell Blu what’s next' };
}

export default function BluNowWidget({ snapshot, width = 320, height = 150 }) {
  const s = snapshot || { state: 'loading' };
  const { heading, title, sub } = content(s);

  const orb = Math.max(64, Math.min(104, height - 2 * PAD));
  const textWidth = Math.max(120, width - orb - GAP - 2 * PAD);
  // Two lines of title in a short widget, three when resized taller; a long title steps down a size.
  const lines = height >= 170 ? 3 : 2;
  const titleSize = title.length > 36 ? 16 : 19;

  return (
    <FlexWidget
      style={{
        width, height, flexDirection: 'row', alignItems: 'center',
        borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.16)',
        backgroundGradient: { from: '#1a2139', to: '#0b1125', orientation: 'TOP_BOTTOM' },
        paddingHorizontal: PAD,
      }}
    >
      <ImageWidget
        image={ORB}
        imageWidth={orb}
        imageHeight={orb}
        clickAction="OPEN_URI"
        clickActionData={{ uri: 'blu://assistant' }}
        accessibilityLabel="Talk to Blu"
      />
      <FlexWidget
        style={{ width: textWidth, height: height - 2 * PAD, flexDirection: 'column', justifyContent: 'center', marginLeft: GAP }}
        clickAction="OPEN_URI"
        clickActionData={{ uri: 'blu://now' }}
      >
        <TextWidget
          text={heading.toUpperCase()}
          style={{ width: textWidth, fontSize: 10.5, fontFamily: 'Heros-Bold', letterSpacing: 0.1, color: LABEL }}
        />
        <TextWidget
          text={title}
          maxLines={lines}
          truncate="END"
          style={{ width: textWidth, fontSize: titleSize, fontFamily: 'Heros-Bold', color: WHITE, marginTop: 3, marginBottom: 4 }}
        />
        {sub ? (
          <TextWidget
            text={s.countdown ? `${sub} · ${s.countdown}` : sub}
            maxLines={1}
            truncate="END"
            style={{ width: textWidth, fontSize: 12, fontFamily: 'Heros-Regular', color: s.countdown ? ACCENT : SUB }}
          />
        ) : null}
      </FlexWidget>
    </FlexWidget>
  );
}
