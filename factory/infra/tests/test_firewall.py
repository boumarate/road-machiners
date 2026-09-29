from firewall import desired_rules


def test_only_ssh_and_web_are_open():
    rules = desired_rules()
    assert sorted(rule["port"] for rule in rules) == ["22", "443", "80"]
    assert all(rule["direction"] == "in" and rule["protocol"] == "tcp" for rule in rules)
