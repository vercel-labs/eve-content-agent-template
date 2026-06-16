# Your tests pass. Your users still hit the bug.

You merged the fix. CI is green. Then a support ticket lands describing the exact
failure you thought you'd closed. The test suite said one thing; production said another.

This gap is expensive. Every hour spent chasing a bug that "can't happen" is an hour not
spent shipping. And it erodes the one thing a test suite is supposed to buy you:
confidence that green means safe.

The usual culprit isn't a missing test. It's a test that asserts the wrong layer. A unit
test mocks the database, so it never sees the constraint that actually fires. The mock
returns what you told it to — not what the real system does under load, with real data, at
the boundary you forgot.

Here's the shift that helps: test the seam, not the unit. Take the checkout flow that kept
regressing for us. We had ninety unit tests on the pricing logic and zero on the path
where pricing meets inventory. One integration test across that seam caught three bugs the
ninety had waved through.

Write fewer mocks. Test where your code meets something it doesn't control — the database,
the API, the queue. That's where green starts meaning safe.
