#!/bin/sh
# YouTube search for the benchmark songs (official Beatles "Remastered 2009" uploads).
cd /d/Features/pianola/worker
for q in "Something Remastered 2009 The Beatles" "Help! Remastered 2009 The Beatles" \
         "Here Comes The Sun Remastered 2009" "In My Life Remastered 2009 Beatles" \
         "Michelle Remastered 2009 Beatles" "Eleanor Rigby Remastered 2009" \
         "Come Together Remastered 2009" "Penny Lane Remastered 2009" \
         "Norwegian Wood This Bird Has Flown Remastered 2009" "A Hard Day's Night Remastered 2009" \
         "Hello Goodbye Remastered 2009" "Ob-La-Di Ob-La-Da Remastered 2009"; do
  echo "== $q"
  .venv/Scripts/yt-dlp.exe --js-runtimes node --flat-playlist \
    --print "%(id)s | %(duration)s | %(title)s | %(channel)s" "ytsearch10:$q" 2>/dev/null \
    | grep -i "| The Beatles$" | head -8
done
