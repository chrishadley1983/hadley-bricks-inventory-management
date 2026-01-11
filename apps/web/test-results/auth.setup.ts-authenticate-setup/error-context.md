# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - img [ref=e5]
      - heading "Hadley Bricks" [level=1] [ref=e9]
      - paragraph [ref=e10]: Inventory Management System
    - generic [ref=e11]:
      - generic [ref=e12]:
        - generic [ref=e13]: Sign in
        - generic [ref=e14]: Enter your email and password to sign in to your account
      - generic [ref=e15]:
        - generic [ref=e16]:
          - generic [ref=e17]:
            - text: Email
            - textbox "Email" [ref=e18]:
              - /placeholder: name@example.com
          - generic [ref=e19]:
            - generic [ref=e20]:
              - generic [ref=e21]: Password
              - link "Forgot password?" [ref=e22] [cursor=pointer]:
                - /url: /forgot-password
            - textbox "Password" [ref=e23]
          - button "Sign in" [ref=e24] [cursor=pointer]
        - generic [ref=e25]:
          - text: Don't have an account?
          - link "Sign up" [ref=e26] [cursor=pointer]:
            - /url: /register
  - region "Notifications (F8)":
    - list
  - button "Open Next.js Dev Tools" [ref=e32] [cursor=pointer]:
    - img [ref=e33]
  - alert [ref=e36]
```